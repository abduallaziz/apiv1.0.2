import { Injectable } from '@nestjs/common';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';
import { SupabaseClient } from '@supabase/supabase-js';
import { PaginationDto } from '../../../shared/dto/pagination.dto';

@Injectable()
export class GoodsReceiptsRepository extends ScopedRepository {
  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  async findAll(tenantId: string, status?: string, pagination: PaginationDto = new PaginationDto()) {
    const { data, error } = await this.supabase.rpc('fn_goods_receipts_list_enriched', {
      p_tenant_id: tenantId,
      p_status: status ?? null,
      p_limit: pagination.perPage,
      p_offset: pagination.offset,
    });
    if (error) throw error;
    return data;
  }

  async findById(id: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('goods_receipts')
      .select(
        '*, warehouses(name, code), purchase_orders(order_number, suppliers(name)), items:goods_receipt_items(*, items(name, sku), purchase_order_items(quantity_ordered))',
      )
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async convertToStorageUnit(itemId: string, quantity: number, unitId: string | null) {
    const { data, error } = await this.supabase.rpc('fn_convert_to_storage_unit', {
      p_item_id: itemId,
      p_quantity: quantity,
      p_unit_id: unitId,
    });
    if (error) throw error;
    return data as number;
  }

  async create(tenantId: string, payload: Record<string, unknown>, items: Record<string, unknown>[]) {
    const { data: receipt, error } = await this.supabase
      .from('goods_receipts')
      .insert({ ...payload, tenant_id: tenantId, status: 'draft' })
      .select()
      .single();
    if (error) throw error;

    const { error: itemsError } = await this.supabase
      .from('goods_receipt_items')
      .insert(items.map((i) => ({ ...i, tenant_id: tenantId, goods_receipt_id: receipt.id })));
    if (itemsError) throw itemsError;

    return this.findById(receipt.id, tenantId);
  }

  // fn_post_goods_receipt_with_ownership (146) calls the existing, unchanged
  // fn_post_goods_receipt internally first, then creates an ownership layer
  // only for lines that declared non-company ownership — behavior is
  // byte-for-byte identical to calling fn_post_goods_receipt directly for
  // every receipt that doesn't use ownership fields.
  async post(id: string, actorId: string) {
    const { data, error } = await this.supabase.rpc('fn_post_goods_receipt_with_ownership', {
      p_goods_receipt_id: id,
      p_actor_id: actorId,
    });
    if (error) throw error;
    return data;
  }

  async cancel(id: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('goods_receipts')
      .update({ status: 'cancelled' })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .eq('status', 'draft')
      .select()
      .single();
    if (error) throw error;
    return data;
  }
}
