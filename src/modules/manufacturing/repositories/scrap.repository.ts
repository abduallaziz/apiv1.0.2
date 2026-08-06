import { Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class ScrapRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async findByProductionOrder(productionOrderId: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('production_order_scraps')
      .select('id, production_order_id, item_id, variant_id, quantity, unit_cost, reason, movement_id, created_by, created_at, items(name, sku)')
      .eq('production_order_id', productionOrderId)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
  }

  // fn_record_production_scrap (migration 155) is the only writer — it
  // reuses fn_consume_cost_layers/fn_apply_stock_movement exactly as
  // fn_post_production_order does for consumption, and is completely
  // independent of that function (never calls it, never modifies it).
  async record(
    tenantId: string,
    warehouseId: string,
    productionOrderId: string,
    itemId: string,
    variantId: string | null,
    quantity: number,
    reason: string | null,
    actorId: string | null,
  ) {
    const { data, error } = await this.supabase.rpc('fn_record_production_scrap', {
      p_tenant_id: tenantId,
      p_warehouse_id: warehouseId,
      p_production_order_id: productionOrderId,
      p_item_id: itemId,
      p_variant_id: variantId,
      p_quantity: quantity,
      p_reason: reason,
      p_actor_id: actorId,
    });
    if (error) throw error;
    return data;
  }
}
