import { Injectable } from '@nestjs/common';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';
import { SupabaseClient } from '@supabase/supabase-js';
import { TenantContext } from '../../../core/tenant/tenant.context';

@Injectable()
export class SupplierCatalogRepository extends ScopedRepository {
  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  private ctx(tenantId: string): TenantContext {
    return { tenantId } as TenantContext;
  }

  async findAll(tenantId: string, supplierId?: string) {
    let query = this.scopedQuery('supplier_catalog', this.ctx(tenantId)).order(
      'created_at',
      { ascending: false },
    );
    if (supplierId) query = query.eq('supplier_id', supplierId);
    const { data, error } = await query;
    if (error) throw error;
    return data;
  }

  async findById(id: string, tenantId: string) {
    const { data, error } = await this.scopedQuery(
      'supplier_catalog',
      this.ctx(tenantId),
    )
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async create(tenantId: string, payload: Record<string, unknown>) {
    const { data, error } = await this.supabase
      .from('supplier_catalog')
      .insert({ ...payload, tenant_id: tenantId })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async markSynced(id: string, tenantId: string) {
    const { error } = await this.supabase
      .from('supplier_catalog')
      .update({
        synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('tenant_id', tenantId);
    if (error) throw error;
  }

  async delete(id: string, tenantId: string) {
    const { error } = await this.supabase
      .from('supplier_catalog')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenantId);
    if (error) throw error;
  }
}
