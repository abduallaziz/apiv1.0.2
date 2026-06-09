import { Injectable, Inject } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../../../shared/supabase/supabase.module';
import { SupabaseClient } from '@supabase/supabase-js';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';
import { TenantContext } from '../../../core/tenant/tenant-context';

@Injectable()
export class InvoicesRepository extends ScopedRepository {
  constructor(@Inject(SUPABASE_CLIENT) supabase: SupabaseClient) {
    super(supabase);
  }

  // H-001 FIX: alias discount → discount_amount in SELECT
  private readonly ORDER_SELECT = `
    id, status, subtotal,
    discount_amount:discount,
    tax, total,
    payment_method, notes, created_at,
    cashier_id, customer_id, branch_id
  `;

  // H-002 + H-003 + H-004 FIX
  private readonly ORDER_ITEMS_SELECT = `
    id, order_id, item_id, item_name,
    quantity:qty,
    unit_price:price,
    total_price,
    variant_id, variant_name
  `;

  private ordersQuery(tenant: TenantContext) {
    const query = this.supabase.from('orders').select('*');
    if (tenant.tenantId) {
      return query.eq('tenant_id', tenant.tenantId);
    }
    return query;
  }

  // H-006 FIX: resolve names from IDs
  private async resolveName(
    table: string,
    id: string | null,
  ): Promise<string | null> {
    if (!id) return null;
    const { data } = await this.supabase
      .from(table)
      .select('name')
      .eq('id', id)
      .single();
    return (data as any)?.name ?? null;
  }

  async findAll(tenant: TenantContext, branchId?: string) {
    let query = this.ordersQuery(tenant).select(this.ORDER_SELECT);

    if (branchId) {
      query = query.eq('branch_id', branchId);
    }

    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;

    const orders = data ?? [];

    // H-006 FIX: resolve cashier and customer names
    const resolved = await Promise.all(
      orders.map(async (o: any) => ({
        ...o,
        cashier_name: await this.resolveName('users', o.cashier_id),
        customer_name: await this.resolveName('customers', o.customer_id),
      })),
    );

    return resolved;
  }

  async findById(tenant: TenantContext, id: string) {
    const { data: order, error: orderError } = await this.ordersQuery(tenant)
      .select(this.ORDER_SELECT)
      .eq('id', id)
      .single();

    if (orderError) throw orderError;
    if (!order) return null;

    const { data: items, error: itemsError } = await this.supabase
      .from('order_items')
      .select(this.ORDER_ITEMS_SELECT)
      .eq('order_id', id);

    if (itemsError) throw itemsError;

    // H-006 FIX: resolve names
    const o = order as any;
    const cashier_name = await this.resolveName('users', o.cashier_id);
    const customer_name = await this.resolveName('customers', o.customer_id);

    return {
      ...o,
      cashier_name,
      customer_name,
      items: items ?? [],
    };
  }

  async create(tenant: TenantContext, payload: Record<string, unknown>) {
    const { data, error } = await this.supabase
      .from('orders')
      .insert({ ...payload, tenant_id: tenant.tenantId })
      .select('id')
      .single();

    if (error) throw error;
    return data;
  }

  async insertItems(items: Record<string, unknown>[]) {
    const mapped = items.map((item) => ({
      order_id: item.order_id,
      item_id: item.item_id,
      item_name: item.item_name,
      qty: item.quantity,
      price: item.unit_price,
      total_price: Number(item.quantity) * Number(item.unit_price),
      variant_id: item.variant_id ?? null,
      variant_name: item.variant_name ?? null,
    }));

    const { error } = await this.supabase.from('order_items').insert(mapped);
    if (error) throw error;
  }

  async cancel(tenant: TenantContext, id: string, cancelledBy: string) {
    const query = this.supabase
      .from('orders')
      .update({ status: 'cancelled' })
      .eq('id', id);

    if (tenant.tenantId) {
      const { data, error } = await query
        .eq('tenant_id', tenant.tenantId)
        .select('id, status')
        .single();
      if (error) throw error;
      return data;
    }

    const { data, error } = await query.select('id, status').single();
    if (error) throw error;
    return data;
  }
}