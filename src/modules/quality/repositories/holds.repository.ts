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

  // Creates the hold AND applies the hard block (fn_apply_stock_movement
  // 'quality_hold') in one transaction — see migration 166.
  async create(tenantId: string, payload: {
    warehouse_id: string; item_id: string; variant_id: string | null;
    location_id: string | null; batch_id: string | null; serial_id: string | null;
    quantity_held: number | null; reason: string | null;
    source_document_type: string | null; source_document_id: string | null;
    quality_inspection_id: string | null; created_by: string | null;
  }) {
    const { data, error } = await this.supabase.rpc('fn_create_quality_hold', {
      p_tenant_id: tenantId,
      p_warehouse_id: payload.warehouse_id,
      p_item_id: payload.item_id,
      p_variant_id: payload.variant_id,
      p_location_id: payload.location_id,
      p_batch_id: payload.batch_id,
      p_serial_id: payload.serial_id,
      p_quantity_held: payload.quantity_held,
      p_reason: payload.reason,
      p_source_document_type: payload.source_document_type,
      p_source_document_id: payload.source_document_id,
      p_quality_inspection_id: payload.quality_inspection_id,
      p_created_by: payload.created_by,
    });
    if (error) throw error;
    return data;
  }

  // Reverses the hard block (fn_apply_stock_movement 'quality_release').
  async release(id: string, tenantId: string, releasedBy: string, reason?: string) {
    const { data, error } = await this.supabase.rpc('fn_release_quality_hold', {
      p_hold_id: id,
      p_tenant_id: tenantId,
      p_actor_id: releasedBy,
      p_reason: reason ?? null,
    });
    if (error) throw error;
    return data;
  }

  // Rejects the hold — disposition stands, held quantity stays excluded.
  async reject(id: string, tenantId: string, actorId: string, disposition: string, reason?: string) {
    const { data, error } = await this.supabase.rpc('fn_reject_quality_hold', {
      p_hold_id: id,
      p_tenant_id: tenantId,
      p_actor_id: actorId,
      p_disposition: disposition,
      p_reason: reason ?? null,
    });
    if (error) throw error;
    return data;
  }

  async findHistory(tenantId: string, holdId: string) {
    const { data, error } = await this.supabase
      .from('quality_hold_history')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('hold_id', holdId)
      .order('created_at', { ascending: false });
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
