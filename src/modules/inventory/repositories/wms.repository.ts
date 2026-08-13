import { Injectable } from '@nestjs/common';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';
import { SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class WmsRepository extends ScopedRepository {
  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  async findShipments(tenantId: string, status?: string) {
    let query = this.supabase
      .from('shipments')
      .select('*, warehouses(name, code), lines:shipment_lines(*, items(name, sku))')
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });
    if (status) query = query.eq('status', status);
    const { data, error } = await query;
    if (error) throw error;
    return data;
  }

  async findShipmentById(id: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('shipments')
      .select('*, warehouses(name, code), lines:shipment_lines(*, items(name, sku))')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async createShipment(tenantId: string, payload: Record<string, unknown>, lines: Record<string, unknown>[]) {
    const { data: shipment, error } = await this.supabase
      .from('shipments')
      .insert({ ...payload, tenant_id: tenantId })
      .select()
      .single();
    if (error) throw error;

    const { error: linesError } = await this.supabase
      .from('shipment_lines')
      .insert(lines.map((l) => ({ ...l, tenant_id: tenantId, shipment_id: shipment.id })));
    if (linesError) throw linesError;

    return this.findShipmentById(shipment.id, tenantId);
  }

  async cancelShipment(id: string, tenantId: string) {
    const { data, error } = await this.supabase.rpc('fn_cancel_shipment', {
      p_shipment_id: id,
      p_tenant_id: tenantId,
    });
    if (error) throw error;
    return data;
  }

  async shipShipment(id: string, actorId: string, trackingNumber?: string) {
    const { data, error } = await this.supabase.rpc('fn_ship_shipment', {
      p_shipment_id: id,
      p_actor_id: actorId,
      p_tracking_number: trackingNumber ?? null,
    });
    if (error) throw error;
    return data;
  }

  async confirmPack(shipmentLineId: string, quantity: number, actorId: string) {
    const { data, error } = await this.supabase.rpc('fn_confirm_pack', {
      p_shipment_line_id: shipmentLineId,
      p_quantity: quantity,
      p_actor_id: actorId,
    });
    if (error) throw error;
    return data;
  }

  async findPickLists(tenantId: string, status?: string) {
    let query = this.supabase
      .from('pick_lists')
      .select('*, warehouses(name, code), shipments:pick_list_shipments(shipment_id), lines:pick_list_lines(*, items(name, sku))')
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });
    if (status) query = query.eq('status', status);
    const { data, error } = await query;
    if (error) throw error;
    return data;
  }

  async findPickListById(id: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('pick_lists')
      .select('*, warehouses(name, code), shipments:pick_list_shipments(shipment_id), lines:pick_list_lines(*, items(name, sku))')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async createPickList(
    tenantId: string,
    warehouseId: string,
    shipmentIds: string[],
    strategy: string,
    zoneLocationId: string | null,
    actorId: string,
  ) {
    const { data, error } = await this.supabase.rpc('fn_create_pick_list', {
      p_tenant_id: tenantId,
      p_warehouse_id: warehouseId,
      p_shipment_ids: shipmentIds,
      p_strategy: strategy,
      p_zone_location_id: zoneLocationId,
      p_actor_id: actorId,
    });
    if (error) throw error;
    return data;
  }

  async confirmPick(pickListLineId: string, quantity: number, actorId: string) {
    const { data, error } = await this.supabase.rpc('fn_confirm_pick', {
      p_pick_list_line_id: pickListLineId,
      p_quantity: quantity,
      p_actor_id: actorId,
    });
    if (error) throw error;
    return data;
  }

  async findPickListLineWithContext(pickListLineId: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('pick_list_lines')
      .select('*, pick_lists(warehouse_id)')
      .eq('id', pickListLineId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  // Enterprise validation gate (migration 171) — called BEFORE
  // fn_confirm_pick, never inside it, so the existing tested picking
  // engine (migration 116) stays untouched. Raises via
  // fn_validate_pick_requirements if the item needs a batch/serial that
  // wasn't given, or if FEFO would be violated.
  async validatePickRequirements(
    tenantId: string, warehouseId: string, itemId: string, variantId: string | null, quantity: number, batchId: string | null,
  ) {
    const { error } = await this.supabase.rpc('fn_validate_pick_requirements', {
      p_tenant_id: tenantId, p_warehouse_id: warehouseId, p_item_id: itemId, p_variant_id: variantId,
      p_quantity: quantity, p_batch_id: batchId,
    });
    if (error) throw error;
  }

  async setPickListLineBatch(pickListLineId: string, tenantId: string, batchId: string) {
    const { error } = await this.supabase
      .from('pick_list_lines')
      .update({ batch_id: batchId })
      .eq('id', pickListLineId)
      .eq('tenant_id', tenantId);
    if (error) throw error;
  }
}
