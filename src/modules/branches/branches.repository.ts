import { Injectable, Inject, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';
import { TenantContext } from '../../core/tenant/tenant-context';
import { ensureBranchWarehouse } from './branch-warehouse.util';

@Injectable()
export class BranchesRepository {
  private readonly logger = new Logger(BranchesRepository.name);

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async findAll(tenant: TenantContext, activeOnly = false) {
    let query = this.supabase
      .from('branches')
      .select(
        'id, name, address, is_active, default_warehouse_id, geofence_lat, geofence_lng, geofence_radius_m, created_at',
      )
      .eq('tenant_id', tenant.tenantId)
      .is('deleted_at', null);

    if (activeOnly) {
      query = query.eq('is_active', true);
    }

    const { data, error } = await query.order('created_at', {
      ascending: false,
    });

    if (error) throw error;
    return data;
  }

  async findById(id: string, tenant: TenantContext) {
    const { data, error } = await this.supabase
      .from('branches')
      .select(
        'id, name, address, is_active, default_warehouse_id, geofence_lat, geofence_lng, geofence_radius_m, created_at',
      )
      .eq('id', id)
      .eq('tenant_id', tenant.tenantId)
      .is('deleted_at', null)
      .single();

    if (error) return null;
    return data;
  }

  async countActive(tenant: TenantContext): Promise<number> {
    const { count, error } = await this.supabase
      .from('branches')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant.tenantId)
      .is('deleted_at', null);

    if (error) throw error;
    return count ?? 0;
  }

  /** Case-insensitive, per-tenant name clash among live branches. */
  async nameExists(
    tenant: TenantContext,
    name: string,
    excludeId?: string,
  ): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('branches')
      .select('id, name')
      .eq('tenant_id', tenant.tenantId)
      .is('deleted_at', null);
    if (error) throw error;
    const wanted = name.trim().toLowerCase();
    return (data ?? []).some(
      (b: { id: string; name: string }) =>
        b.id !== excludeId && String(b.name).trim().toLowerCase() === wanted,
    );
  }

  async hasOpenShift(id: string, tenant: TenantContext): Promise<boolean> {
    const { count, error } = await this.supabase
      .from('shifts')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant.tenantId)
      .eq('branch_id', id)
      .eq('status', 'open')
      .is('deleted_at', null);
    if (error) throw error;
    return (count ?? 0) > 0;
  }

  /** True when the branch already has shifts or invoices (real history). */
  async hasHistory(id: string, tenant: TenantContext): Promise<boolean> {
    for (const table of ['shifts', 'invoices']) {
      const { count, error } = await this.supabase
        .from(table)
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenant.tenantId)
        .eq('branch_id', id);
      if (error) throw error;
      if ((count ?? 0) > 0) return true;
    }
    return false;
  }

  /** Keeps the auto-created "Warehouse - <name>" label in step with a rename. */
  async renameAutoWarehouse(
    tenant: TenantContext,
    warehouseId: string | null,
    oldName: string,
    newName: string,
  ) {
    if (!warehouseId) return;
    const { error } = await this.supabase
      .from('warehouses')
      .update({ name: `Warehouse - ${newName}`.slice(0, 120) })
      .eq('id', warehouseId)
      .eq('tenant_id', tenant.tenantId)
      .eq('name', `Warehouse - ${oldName}`.slice(0, 120));
    if (error) this.logger.warn(`Warehouse rename failed: ${error.message}`);
  }

  async create(
    tenant: TenantContext,
    data: { name: string; address?: string },
  ) {
    const { data: branch, error } = await this.supabase
      .from('branches')
      .insert({
        tenant_id: tenant.tenantId,
        name: data.name,
        address: data.address ?? null,
        is_active: true,
      })
      .select(
        'id, name, address, is_active, default_warehouse_id, geofence_lat, geofence_lng, geofence_radius_m, created_at',
      )
      .single();

    if (error) {
      this.logger.error(
        `Supabase error creating branch: ${JSON.stringify(error)}`,
      );
      throw error;
    }

    // Every branch gets a usable default warehouse (best-effort, never throws).
    const warehouseId = await ensureBranchWarehouse(
      this.supabase,
      tenant.tenantId,
      branch.id as string,
      branch.name as string,
      this.logger,
    );
    return warehouseId
      ? { ...branch, default_warehouse_id: warehouseId }
      : branch;
  }

  async update(
    id: string,
    tenant: TenantContext,
    data: Partial<{
      name: string;
      address: string;
      is_active: boolean;
      default_warehouse_id: string | null;
      geofence_lat: number | null;
      geofence_lng: number | null;
      geofence_radius_m: number | null;
    }>,
  ) {
    const { data: branch, error } = await this.supabase
      .from('branches')
      .update(data)
      .eq('id', id)
      .eq('tenant_id', tenant.tenantId)
      .is('deleted_at', null)
      .select(
        'id, name, address, is_active, default_warehouse_id, geofence_lat, geofence_lng, geofence_radius_m, created_at',
      )
      .single();

    if (error) throw error;
    return branch;
  }

  async warehouseBelongsToTenant(
    warehouseId: string,
    tenantId: string,
  ): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('warehouses')
      .select('id')
      .eq('id', warehouseId)
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw error;
    return !!data;
  }

  async softDelete(id: string, tenant: TenantContext) {
    const { error } = await this.supabase
      .from('branches')
      .update({ deleted_at: new Date().toISOString(), is_active: false })
      .eq('id', id)
      .eq('tenant_id', tenant.tenantId)
      .is('deleted_at', null);

    if (error) throw error;
  }
}
