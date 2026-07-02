import { Injectable, Inject } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../../../shared/supabase/supabase.module';
import { SupabaseClient } from '@supabase/supabase-js';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';
import { TenantContext } from '../../../core/tenant/tenant-context';
import { PaginationDto } from '../../../shared/dto/pagination.dto';

@Injectable()
export class InvoicesRepository extends ScopedRepository {
  constructor(@Inject(SUPABASE_CLIENT) supabase: SupabaseClient) {
    super(supabase);
  }

  private readonly ORDER_SELECT = `
    id, status, subtotal,
    discount_amount:discount,
    tax, total,
    payment_method, notes, created_at,
    cashier_id, customer_id, branch_id,
    cashier:users!orders_cashier_id_fkey(name),
    customer:customers!orders_customer_id_fkey(full_name)
  `;

  private readonly ORDER_ITEMS_SELECT = `
    id, order_id, item_id, item_name,
    quantity:qty,
    unit_price:price,
    total_price,
    variant_id, variant_name
  `;

  private ordersQuery(tenant: TenantContext) {
    const query = this.supabase.from('orders').select('*');
    // tenantId is null only for superadmin callers — intentional cross-tenant access
    if (tenant.tenantId) {
      return query.eq('tenant_id', tenant.tenantId);
    }
    return query;
  }

  async findAll(
    tenant: TenantContext,
    branchId?: string,
    dateFrom?: string,
    dateTo?: string,
    pagination: PaginationDto = new PaginationDto(),
    status?: string,
  ) {
    let query = this.ordersQuery(tenant).select(this.ORDER_SELECT);

    if (branchId) query = query.eq('branch_id', branchId);
    if (dateFrom) query = query.gte('created_at', dateFrom);
    if (dateTo) query = query.lte('created_at', dateTo + 'T23:59:59.999Z');
    if (status) query = query.eq('status', status);

    const [from, to] = pagination.range;
    const { data, error } = await query
      .order('created_at', { ascending: false })
      .range(from, to);
    if (error) throw error;

    const orders = data ?? [];
    return orders.map((o: any) => ({
      ...o,
      cashier_name: (o.cashier as any)?.name ?? null,
      customer_name: (o.customer as any)?.full_name ?? null,
      cashier: undefined,
      customer: undefined,
    }));
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

    const o = order as any;
    return {
      ...o,
      cashier_name: (o.cashier as any)?.name ?? null,
      customer_name: (o.customer as any)?.full_name ?? null,
      cashier: undefined,
      customer: undefined,
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

    // tenantId is null only for superadmin callers — intentional cross-tenant access
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