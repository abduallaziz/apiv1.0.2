import { Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class OutputsRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async findByProductionOrder(productionOrderId: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('production_order_outputs')
      .select(
        'id, production_order_id, item_id, variant_id, quantity, unit_cost, output_type, movement_id, created_at, updated_at, items(name, sku)',
      )
      .eq('production_order_id', productionOrderId)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data ?? [];
  }

  async findById(id: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('production_order_outputs')
      .select(
        'id, production_order_id, item_id, variant_id, quantity, unit_cost, output_type, movement_id, created_at, updated_at',
      )
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  // Unposted by_product rows for a production order — what
  // ProductionOrdersService.complete() automatically receives right after
  // fn_post_production_order succeeds.
  async findUnpostedByProducts(productionOrderId: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('production_order_outputs')
      .select('id')
      .eq('production_order_id', productionOrderId)
      .eq('tenant_id', tenantId)
      .eq('output_type', 'by_product')
      .is('movement_id', null);
    if (error) throw error;
    return data ?? [];
  }

  async create(
    productionOrderId: string,
    tenantId: string,
    payload: Record<string, unknown>,
  ) {
    const { data, error } = await this.supabase
      .from('production_order_outputs')
      .insert({
        ...payload,
        production_order_id: productionOrderId,
        tenant_id: tenantId,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async update(id: string, tenantId: string, payload: Record<string, unknown>) {
    const { data, error } = await this.supabase
      .from('production_order_outputs')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async receive(
    tenantId: string,
    warehouseId: string,
    outputId: string,
    actorId: string | null,
  ) {
    const { data, error } = await this.supabase.rpc(
      'fn_receive_production_output',
      {
        p_tenant_id: tenantId,
        p_warehouse_id: warehouseId,
        p_output_id: outputId,
        p_actor_id: actorId,
      },
    );
    if (error) throw error;
    return data;
  }
}
