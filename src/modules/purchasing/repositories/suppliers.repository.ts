import { Injectable } from '@nestjs/common';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';
import { SupabaseClient } from '@supabase/supabase-js';
import { TenantContext } from '../../../core/tenant/tenant.context';

@Injectable()
export class SuppliersRepository extends ScopedRepository {
  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  private ctx(tenantId: string): TenantContext {
    return { tenantId } as TenantContext;
  }

  async findAll(tenantId: string) {
    const { data, error } = await this.scopedQuery('suppliers', this.ctx(tenantId)).order('name');
    if (error) throw error;
    return data;
  }

  async findById(id: string, tenantId: string) {
    const { data, error } = await this.scopedQuery('suppliers', this.ctx(tenantId))
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  }

  async create(tenantId: string, payload: Record<string, unknown>) {
    const { data, error } = await this.supabase
      .from('suppliers')
      .insert({ ...payload, tenant_id: tenantId, is_active: payload.is_active ?? true })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async update(id: string, tenantId: string, payload: Record<string, unknown>) {
    const { data, error } = await this.supabase
      .from('suppliers')
      .update(payload)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async softDelete(id: string, tenantId: string) {
    const { error } = await this.supabase
      .from('suppliers')
      .update({ deleted_at: new Date().toISOString(), is_active: false })
      .eq('id', id)
      .eq('tenant_id', tenantId);
    if (error) throw error;
  }

  async findProfileStats(id: string, tenantId: string) {
    const { data, error } = await this.supabase.rpc('fn_supplier_profile_stats', {
      p_tenant_id: tenantId,
      p_supplier_id: id,
    });
    if (error) throw error;
    return data?.[0] ?? null;
  }
}
