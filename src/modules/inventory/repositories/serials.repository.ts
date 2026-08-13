import { Injectable, ConflictException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';

interface PostgrestError {
  code?: string;
  message?: string;
}

function isPostgrestError(error: unknown): error is PostgrestError {
  return typeof error === 'object' && error !== null && 'code' in error;
}

const SERIAL_SELECT =
  'id, tenant_id, item_id, variant_id, batch_id, warehouse_id, serial_number, status, ' +
  'warranty_months, warranty_expires_at, sold_order_id, sold_at, created_at, updated_at, ' +
  'items(name, sku), item_variants(name, sku), warehouses(name, code)';

@Injectable()
export class SerialsRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async findById(id: string, tenantId: string): Promise<any> {
    const { data, error } = await this.supabase
      .from('item_serials')
      .select(SERIAL_SELECT)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  // Search by number is deliberately item-agnostic (the whole point of a
  // search box) — the unique constraint is (tenant, item, serial_number),
  // so more than one item could theoretically share a serial string across
  // different products; returns every match, same shape as findById.
  async findByNumber(serialNumber: string, tenantId: string): Promise<any[]> {
    const { data, error } = await this.supabase
      .from('item_serials')
      .select(SERIAL_SELECT)
      .eq('serial_number', serialNumber)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null);
    if (error) throw error;
    return data ?? [];
  }

  async findByItem(
    itemId: string,
    tenantId: string,
    status?: string,
  ): Promise<any[]> {
    let query = this.supabase
      .from('item_serials')
      .select(SERIAL_SELECT)
      .eq('item_id', itemId)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });
    if (status) query = query.eq('status', status);
    const { data, error } = await query;
    if (error) throw error;
    return data ?? [];
  }

  async findByWarehouse(
    warehouseId: string,
    tenantId: string,
    status?: string,
  ): Promise<any[]> {
    let query = this.supabase
      .from('item_serials')
      .select(SERIAL_SELECT)
      .eq('warehouse_id', warehouseId)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });
    if (status) query = query.eq('status', status);
    const { data, error } = await query;
    if (error) throw error;
    return data ?? [];
  }

  // Customer history: serials sold under any order belonging to this
  // customer — orders.customer_id is the existing, unmodified linkage
  // (Phase 4 uses it as-is rather than adding a direct customer_id column
  // to item_serials, per "least invasive design" / "prefer sold_order_id").
  async findByCustomer(customerId: string, tenantId: string): Promise<any[]> {
    const { data: orders, error: ordersError } = await this.supabase
      .from('orders')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('customer_id', customerId);
    if (ordersError) throw ordersError;

    const orderIds = (orders ?? []).map((o: { id: string }) => o.id);
    if (orderIds.length === 0) return [];

    const { data, error } = await this.supabase
      .from('item_serials')
      .select(SERIAL_SELECT)
      .in('sold_order_id', orderIds)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .order('sold_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
  }

  // The order row IS the invoice (InvoicesRepository operates on the same
  // `orders` table) — this resolves "which customer, when" for a serial's
  // sale, reusing that existing relationship rather than a new join table.
  async findOrderCustomer(orderId: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('orders')
      .select(
        'id, customer_id, created_at, total, customers(id, full_name, phone, email)',
      )
      .eq('tenant_id', tenantId)
      .eq('id', orderId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async sell(serialId: string, orderId: string, warrantyMonths: number | null) {
    const { data, error } = await this.supabase.rpc('fn_sell_serial', {
      p_serial_id: serialId,
      p_order_id: orderId,
      p_warranty_months: warrantyMonths,
    });
    if (error) {
      if (
        isPostgrestError(error) &&
        error.message?.includes('is not in_stock')
      ) {
        throw new ConflictException(error.message);
      }
      throw error;
    }
    return data;
  }

  async returnSerial(serialId: string) {
    const { data, error } = await this.supabase.rpc('fn_return_serial', {
      p_serial_id: serialId,
    });
    if (error) {
      if (isPostgrestError(error) && error.message?.includes('is not sold')) {
        throw new ConflictException(error.message);
      }
      throw error;
    }
    return data;
  }

  // Serials sold under a specific order — used by the cancel/return flow to
  // find which units need fn_return_serial called (order id is opaque to
  // that flow otherwise).
  async findSoldByOrder(orderId: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('item_serials')
      .select('id')
      .eq('sold_order_id', orderId)
      .eq('tenant_id', tenantId)
      .eq('status', 'sold');
    if (error) throw error;
    return data ?? [];
  }
}
