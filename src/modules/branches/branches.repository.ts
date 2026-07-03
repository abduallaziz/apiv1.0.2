import { Injectable, Inject, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';
import { TenantContext } from '../../core/tenant/tenant-context';

@Injectable()
export class BranchesRepository {
  private readonly logger = new Logger(BranchesRepository.name);

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async findAll(tenant: TenantContext) {
    const { data, error } = await this.supabase
      .from('branches')
      .select('id, name, address, is_active, default_warehouse_id, created_at')
      .eq('tenant_id', tenant.tenantId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
  }

  async findById(id: string, tenant: TenantContext) {
    const { data, error } = await this.supabase
      .from('branches')
      .select('id, name, address, is_active, default_warehouse_id, created_at')
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

  async create(tenant: TenantContext, data: { name: string; address?: string }) {
    const { data: branch, error } = await this.supabase
      .from('branches')
      .insert({
        tenant_id: tenant.tenantId,
        name: data.name,
        address: data.address ?? null,
        is_active: true,
      })
      .select('id, name, address, is_active, default_warehouse_id, created_at')
      .single();

    if (error) {
      this.logger.error(`Supabase error creating branch: ${JSON.stringify(error)}`);
      throw error;
    }
    return branch;
  }

  async update(id: string, tenant: TenantContext, data: Partial<{ name: string; address: string; is_active: boolean; default_warehouse_id: string | null }>) {
    const { data: branch, error } = await this.supabase
      .from('branches')
      .update(data)
      .eq('id', id)
      .eq('tenant_id', tenant.tenantId)
      .is('deleted_at', null)
      .select('id, name, address, is_active, default_warehouse_id, created_at')
      .single();

    if (error) throw error;
    return branch;
  }

  async warehouseBelongsToTenant(warehouseId: string, tenantId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('warehouses')
      .select('id')
      .eq('id', warehouseId)
      .eq('tenant_id', tenantId)
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