import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';
import { TenantContext } from '../../core/tenant/tenant.context';

const COLS = 'id, tenant_id, branch_id, name, is_active, sort_order, created_at';

@Injectable()
export class PosRegistersRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  /** Registers of a branch. The caller passes the already-authorized branch (central = any tenant branch,
   *  restricted = own), so no extra isolation filter is applied here. */
  async listByBranch(tenant: TenantContext, branchId: string) {
    const { data, error } = await this.supabase
      .from('pos_registers')
      .select(COLS)
      .eq('tenant_id', tenant.tenantId)
      .eq('branch_id', branchId)
      .is('deleted_at', null)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data ?? [];
  }

  async findById(tenant: TenantContext, id: string) {
    const { data, error } = await this.supabase
      .from('pos_registers')
      .select(COLS)
      .eq('tenant_id', tenant.tenantId)
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async create(
    tenant: TenantContext,
    data: { branch_id: string; name: string; sort_order?: number },
  ) {
    const { data: row, error } = await this.supabase
      .from('pos_registers')
      .insert({
        tenant_id: tenant.tenantId,
        branch_id: data.branch_id,
        name: data.name,
        sort_order: data.sort_order ?? 0,
      })
      .select(COLS)
      .single();
    if (error) throw error;
    return row;
  }

  async update(
    tenant: TenantContext,
    id: string,
    patch: { name?: string; is_active?: boolean; sort_order?: number },
  ) {
    const { data, error } = await this.supabase
      .from('pos_registers')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('tenant_id', tenant.tenantId)
      .eq('id', id)
      .is('deleted_at', null)
      .select(COLS)
      .single();
    if (error) throw error;
    return data;
  }

  async softDelete(tenant: TenantContext, id: string) {
    const { error } = await this.supabase
      .from('pos_registers')
      .update({ deleted_at: new Date().toISOString(), is_active: false })
      .eq('tenant_id', tenant.tenantId)
      .eq('id', id);
    if (error) throw error;
  }

  /** True when the register currently has an open shift (blocks rename-to-inactive / delete). */
  async hasOpenShift(tenantId: string, registerId: string): Promise<boolean> {
    const { count, error } = await this.supabase
      .from('shifts')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('register_id', registerId)
      .eq('status', 'open')
      .is('deleted_at', null);
    if (error) throw error;
    return (count ?? 0) > 0;
  }
}
