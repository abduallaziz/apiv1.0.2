import { Injectable } from '@nestjs/common';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';
import { SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class CountsRepository extends ScopedRepository {
  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  async findAll(tenantId: string, status?: string) {
    let query = this.supabase
      .from('stock_counts')
      .select('*, warehouses(name, code)')
      .eq('tenant_id', tenantId);
    if (status) query = query.eq('status', status);
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  }

  async findById(id: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('stock_counts')
      .select('*, items:stock_count_items(*, items(name, sku))')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single();
    if (error) throw error;
    return data;
  }

  async create(tenantId: string, payload: Record<string, unknown>, startedBy: string) {
    const { data, error } = await this.supabase
      .from('stock_counts')
      .insert({ ...payload, tenant_id: tenantId, status: 'draft' })
      .select()
      .single();
    if (error) throw error;

    // Snapshot expected quantities from current stock_levels for the warehouse
    // so counters see what the system believes is on hand at count time.
    const { data: levels, error: levelsError } = await this.supabase
      .from('stock_levels')
      .select('item_id, variant_id, batch_id, location_id, quantity_on_hand')
      .eq('tenant_id', tenantId)
      .eq('warehouse_id', data.warehouse_id);
    if (levelsError) throw levelsError;

    if (levels && levels.length > 0) {
      const { error: itemsError } = await this.supabase.from('stock_count_items').insert(
        levels.map((l) => ({
          tenant_id: tenantId,
          stock_count_id: data.id,
          item_id: l.item_id,
          variant_id: l.variant_id,
          batch_id: l.batch_id,
          location_id: l.location_id,
          expected_quantity: l.quantity_on_hand,
        })),
      );
      if (itemsError) throw itemsError;
    }

    await this.supabase
      .from('stock_counts')
      .update({ status: 'in_progress', started_by: startedBy, started_at: new Date().toISOString() })
      .eq('id', data.id);

    return this.findById(data.id, tenantId);
  }

  async submitCount(countItemId: string, tenantId: string, countedQuantity: number) {
    const { data, error } = await this.supabase
      .from('stock_count_items')
      .update({ counted_quantity: countedQuantity })
      .eq('id', countItemId)
      .eq('tenant_id', tenantId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async finalize(stockCountId: string, actorId: string) {
    const { data, error } = await this.supabase.rpc('fn_finalize_stock_count', {
      p_stock_count_id: stockCountId,
      p_actor_id: actorId,
    });
    if (error) throw error;
    return data;
  }
}
