import { Injectable, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../../shared/supabase/supabase.module';

@Injectable()
export class DineInRepository {
  constructor(@Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient) {}

  async findOpenOrderByTable(tenantId: string, tableId: string) {
    const { data, error } = await this.supabase
      .from('orders')
      .select('id, branch_id, cashier_id, table_id, subtotal, discount, tax, total, status, created_at')
      .eq('tenant_id', tenantId)
      .eq('table_id', tableId)
      .eq('status', 'pending')
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async createOpenOrder(tenantId: string, branchId: string, cashierId: string, tableId: string) {
    const { data, error } = await this.supabase
      .from('orders')
      .insert({
        tenant_id: tenantId,
        branch_id: branchId,
        cashier_id: cashierId,
        table_id: tableId,
        status: 'pending',
        subtotal: 0,
        discount: 0,
        tax: 0,
        total: 0,
      })
      .select('id, branch_id, cashier_id, table_id, subtotal, discount, tax, total, status, created_at')
      .single();
    if (error) throw error;
    return data;
  }

  async insertItems(orderId: string, tenantId: string, items: { item_id: string; item_name: string; variant_id?: string | null; variant_name?: string | null; quantity: number; unit_price: number }[]) {
    const mapped = items.map((item) => ({
      order_id: orderId,
      item_id: item.item_id,
      item_name: item.item_name,
      qty: item.quantity,
      price: item.unit_price,
      total_price: parseFloat((item.unit_price * item.quantity).toFixed(2)),
      variant_id: item.variant_id ?? null,
      variant_name: item.variant_name ?? null,
      kitchen_status: 'pending',
    }));
    const { error } = await this.supabase.from('order_items').insert(mapped);
    if (error) throw error;
  }

  async getOrderItems(orderId: string) {
    const { data, error } = await this.supabase
      .from('order_items')
      .select('id, item_id, item_name, qty, price, total_price, variant_id, variant_name, kitchen_status, created_at')
      .eq('order_id', orderId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data ?? [];
  }

  async updateOrderTotals(orderId: string, tenantId: string, totals: { subtotal: number; discount: number; tax: number; total: number }) {
    const { error } = await this.supabase
      .from('orders')
      .update(totals)
      .eq('id', orderId)
      .eq('tenant_id', tenantId);
    if (error) throw error;
  }

  async finalizeOrder(orderId: string, tenantId: string, updates: { status: string; payment_method: string; customer_id: string | null }) {
    const { data, error } = await this.supabase
      .from('orders')
      .update(updates)
      .eq('id', orderId)
      .eq('tenant_id', tenantId)
      .select('id, branch_id, cashier_id, table_id, subtotal, discount, tax, total, status, payment_method')
      .single();
    if (error) throw error;
    return data;
  }

  async updateItemKitchenStatus(itemId: string, tenantId: string, status: string) {
    // order_items has no tenant_id column — scope via the parent order's tenant_id instead.
    const { data: item, error: findErr } = await this.supabase
      .from('order_items')
      .select('id, order_id, orders!inner(tenant_id)')
      .eq('id', itemId)
      .eq('orders.tenant_id', tenantId)
      .maybeSingle();
    if (findErr) throw findErr;
    if (!item) return null;

    const { data, error } = await this.supabase
      .from('order_items')
      .update({ kitchen_status: status })
      .eq('id', itemId)
      .select('id, order_id, item_name, kitchen_status')
      .single();
    if (error) throw error;
    return data;
  }
}
