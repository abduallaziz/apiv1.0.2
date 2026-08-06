import { Injectable } from '@nestjs/common';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';
import { SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class HoldsRepository extends ScopedRepository {
  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  async findAll(tenantId: string) {
    const { data, error } = await this.supabase
      .from('quality_holds')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  }

  async findById(id: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('quality_holds')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async create(tenantId: string, payload: Record<string, unknown>) {
    const { data, error } = await this.supabase
      .from('quality_holds')
      .insert({ ...payload, tenant_id: tenantId, status: 'active' })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async release(id: string, tenantId: string, releasedBy: string, releasedAt: string, newStatus: 'released') {
    const { data, error } = await this.supabase
      .from('quality_holds')
      .update({ status: newStatus, released_by: releasedBy, released_at: releasedAt })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .eq('status', 'active')
      .select()
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  // Advisory-only lookup, used exclusively by InvoicesService before its
  // existing deductStockForSale() call — read-only, never blocks.
  async checkHolds(tenantId: string, warehouseId: string, items: { item_id: string; variant_id: string | null }[]) {
    const { data, error } = await this.supabase.rpc('fn_check_quality_holds', {
      p_tenant_id: tenantId,
      p_warehouse_id: warehouseId,
      p_items: items,
    });
    if (error) throw error;
    return data;
  }
}
