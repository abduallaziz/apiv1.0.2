import { Injectable } from '@nestjs/common';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';
import { SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class OwnershipRepository extends ScopedRepository {
  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  async findAll(
    tenantId: string,
    filters: {
      status?: string;
      warehouse_id?: string;
      item_id?: string;
      ownership_type?: string;
    } = {},
  ) {
    let q = this.supabase
      .from('stock_ownership_layers')
      .select('*')
      .eq('tenant_id', tenantId);
    if (filters.status) q = q.eq('status', filters.status);
    if (filters.warehouse_id) q = q.eq('warehouse_id', filters.warehouse_id);
    if (filters.item_id) q = q.eq('item_id', filters.item_id);
    if (filters.ownership_type)
      q = q.eq('ownership_type', filters.ownership_type);
    const { data, error } = await q.order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  }

  async findById(id: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('stock_ownership_layers')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async create(tenantId: string, payload: Record<string, unknown>) {
    const { data, error } = await this.supabase
      .from('stock_ownership_layers')
      .insert({ ...payload, tenant_id: tenantId, status: 'active' })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  // Closes the current layer and creates a new one under a different owner
  // — the explicit "ownership transfer" action, distinct from a physical
  // location Transfer (which never touches ownership_type/owner_id).
  async transfer(
    id: string,
    tenantId: string,
    payload: Record<string, unknown>,
  ) {
    const { data: current, error: findErr } = await this.supabase
      .from('stock_ownership_layers')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .eq('status', 'active')
      .maybeSingle();
    if (findErr) throw findErr;
    if (!current) return null;

    const { error: closeErr } = await this.supabase
      .from('stock_ownership_layers')
      .update({ status: 'closed', closed_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .eq('status', 'active');
    if (closeErr) throw closeErr;

    const { data: created, error: createErr } = await this.supabase
      .from('stock_ownership_layers')
      .insert({
        tenant_id: tenantId,
        warehouse_id: current.warehouse_id,
        location_id: current.location_id,
        item_id: current.item_id,
        variant_id: current.variant_id,
        quantity: current.quantity,
        status: 'active',
        source_reference_type: 'ownership_transfer',
        source_reference_id: id,
        ...payload,
      })
      .select()
      .single();
    if (createErr) throw createErr;
    return created;
  }

  async release(id: string, tenantId: string, reason?: string) {
    const { data, error } = await this.supabase
      .from('stock_ownership_layers')
      .update({
        status: 'released',
        closed_at: new Date().toISOString(),
        reason: reason ?? undefined,
      })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .eq('status', 'active')
      .select()
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  // Any active layer for this item/warehouse/variant — used by the
  // Manufacturing "block owned components" guard (Migration 10.1 scope).
  async findActiveForItem(
    tenantId: string,
    warehouseId: string,
    itemId: string,
    variantId: string | null,
  ) {
    let q = this.supabase
      .from('stock_ownership_layers')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('warehouse_id', warehouseId)
      .eq('item_id', itemId)
      .eq('status', 'active');
    q = variantId ? q.eq('variant_id', variantId) : q.is('variant_id', null);
    const { data, error } = await q;
    if (error) throw error;
    return data ?? [];
  }

  // Advisory-only consumption call for the sale path (Invoices integration)
  // — never throws in a way that should block a sale; the caller wraps this
  // in its own try/catch per the Quality Hold precedent.
  async consumeForSale(
    tenantId: string,
    warehouseId: string,
    itemId: string,
    variantId: string | null,
    quantity: number,
  ) {
    const { data, error } = await this.supabase.rpc(
      'fn_consume_ownership_layers',
      {
        p_tenant_id: tenantId,
        p_warehouse_id: warehouseId,
        p_item_id: itemId,
        p_variant_id: variantId,
        p_quantity: quantity,
      },
    );
    if (error) throw error;
    return data as number; // quantity actually consumed from active layers (0 if none)
  }
}
