import { Injectable } from '@nestjs/common';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';
import { SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class ReorderPointsRepository extends ScopedRepository {
  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  async findAll(tenantId: string, warehouseId?: string) {
    let query = this.supabase
      .from('inventory_reorder_points')
      .select('*, items(name, sku), warehouses(name, code)')
      .eq('tenant_id', tenantId)
      .eq('is_active', true);
    if (warehouseId) query = query.eq('warehouse_id', warehouseId);
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  }

  async findById(id: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('inventory_reorder_points')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async upsert(tenantId: string, payload: Record<string, unknown>) {
    const { data, error } = await this.supabase
      .from('inventory_reorder_points')
      .upsert(
        { ...payload, tenant_id: tenantId },
        { onConflict: 'tenant_id,warehouse_id,item_id,variant_id' },
      )
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async update(id: string, tenantId: string, payload: Record<string, unknown>) {
    const { data, error } = await this.supabase
      .from('inventory_reorder_points')
      .update(payload)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async remove(id: string, tenantId: string) {
    const { error } = await this.supabase
      .from('inventory_reorder_points')
      .update({ is_active: false })
      .eq('id', id)
      .eq('tenant_id', tenantId);
    if (error) throw error;
  }

  // Items whose on-hand quantity (per stock_levels) is at/below min_quantity.
  async findBelowMinimum(tenantId: string) {
    const { data, error } = await this.supabase.rpc('fn_items_below_reorder_point', {
      p_tenant_id: tenantId,
    });
    if (error) throw error;
    return data;
  }
}
