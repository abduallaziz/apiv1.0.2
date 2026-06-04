import { Injectable, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';
import { TenantContext } from '../../core/tenant/tenant-context';

@Injectable()
export class BranchesRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async findAll(tenant: TenantContext) {
    const { data, error } = await this.supabase
      .from('branches')
      .select('id, name, address, is_active, created_at')
      .eq('tenant_id', tenant.tenantId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
  }

  async findById(id: string, tenant: TenantContext) {
    const { data, error } = await this.supabase
      .from('branches')
      .select('id, name, address, is_active, created_at')
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
      .select('id, name, address, is_active, created_at')
      .single();

    if (error) {
      console.error('SUPABASE ERROR:', JSON.stringify(error, null, 2));
      throw error;
    }
    return branch;
  }

  async update(id: string, tenant: TenantContext, data: Partial<{ name: string; address: string; is_active: boolean }>) {
    const { data: branch, error } = await this.supabase
      .from('branches')
      .update(data)
      .eq('id', id)
      .eq('tenant_id', tenant.tenantId)
      .is('deleted_at', null)
      .select('id, name, address, is_active, created_at')
      .single();

    if (error) throw error;
    return branch;
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