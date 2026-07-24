import { Injectable, Inject } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../../../shared/supabase/supabase.module';
import { SupabaseClient } from '@supabase/supabase-js';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';
import { TenantContext } from '../../../core/tenant/tenant-context';
import { TenantSessionService } from '../../../core/tenant/tenant-session.service';
import { PaginationDto } from '../../../shared/dto/pagination.dto';

interface PooledInvoiceItem {
  item_id: string;
  item_name: string;
  variant_id?: string | null;
  variant_name?: string | null;
  quantity: number;
  unit_price: number;
}

@Injectable()
export class InvoicesRepository extends ScopedRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) supabase: SupabaseClient,
    private readonly tenantSession: TenantSessionService,
  ) {
    super(supabase);
  }

  /**
   * Pooled, RLS-enforced, atomic equivalent of `create()` + `insertItems()`
   * combined into one transaction — closes two gaps the PostgREST path has
   * today: (1) tenant isolation relies solely on service_role + app-level
   * `.eq('tenant_id', ...)`, not DB-enforced RLS; (2) order + order_items are
   * two independent HTTP calls, not atomic, so a crash between them can leave
   * an order with zero items. `SET LOCAL app.tenant_id` (via
   * `TenantSessionService`) makes migration 075's RLS policies binding for
   * this write, and a single `BEGIN`/`COMMIT` covers both inserts.
   *
   * Gated behind `POOLED_INVOICE_WRITES_ENABLED` in `InvoicesService.create()`
   * — do not call this until that flag is intentionally enabled (see
   * `.env.example` and `TASKS.md`).
   */
  async createWithItemsPooled(
    tenant: TenantContext,
    orderPayload: Record<string, unknown>,
    items: PooledInvoiceItem[],
  ): Promise<{ id: string }> {
    return this.tenantSession.runInTenantContext(tenant, async (client) => {
      const orderResult = await client.query<{ id: string }>(
        `INSERT INTO orders (
           tenant_id, branch_id, cashier_id, customer_id, status,
           subtotal, discount, tax, total, payment_method, notes,
           coupon_code, gift_card_code, gift_card_amount
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         RETURNING id`,
        [
          tenant.tenantId,
          orderPayload.branch_id,
          orderPayload.cashier_id,
          orderPayload.customer_id ?? null,
          orderPayload.status,
          orderPayload.subtotal,
          orderPayload.discount,
          orderPayload.tax,
          orderPayload.total,
          orderPayload.payment_method,
          orderPayload.notes ?? null,
          orderPayload.coupon_code ?? null,
          orderPayload.gift_card_code ?? null,
          orderPayload.gift_card_amount ?? null,
        ],
      );
      const orderId = orderResult.rows[0].id;

      for (const item of items) {
        await client.query(
          `INSERT INTO order_items (
             order_id, item_id, item_name, qty, price, total_price,
             variant_id, variant_name
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            orderId,
            item.item_id,
            item.item_name,
            item.quantity,
            item.unit_price,
            Number(item.quantity) * Number(item.unit_price),
            item.variant_id ?? null,
            item.variant_name ?? null,
          ],
        );
      }

      return { id: orderId };
    });
  }

  private readonly ORDER_SELECT = `
    id, status, subtotal,
    discount_amount:discount,
    tax, total,
    payment_method, notes, created_at,
    cashier_id, customer_id, branch_id,
    held, held_visibility, held_by, held_at,
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
      .maybeSingle();

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

  async getBranchDefaultWarehouse(branchId: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .from('branches')
      .select('default_warehouse_id')
      .eq('id', branchId)
      .single();
    if (error || !data) return null;
    return data.default_warehouse_id ?? null;
  }

  async deductStockForSale(
    tenantId: string,
    warehouseId: string,
    orderId: string,
    actorId: string,
    items: { item_id: string; variant_id: string | null; quantity: number }[],
  ): Promise<void> {
    const { error } = await this.supabase.rpc('fn_process_sale_stock_deduction', {
      p_tenant_id: tenantId,
      p_warehouse_id: warehouseId,
      p_order_id: orderId,
      p_actor_id: actorId,
      p_items: items,
    });
    if (error) throw error;
  }

  async reverseSaleStockDeduction(tenantId: string, orderId: string, actorId: string): Promise<void> {
    const { error } = await this.supabase.rpc('fn_reverse_sale_stock_deduction', {
      p_tenant_id: tenantId,
      p_order_id: orderId,
      p_actor_id: actorId,
    });
    if (error) throw error;
  }

  // Held-orders: reuses create()/insertItems()/findById() above for the
  // actual insert/fetch — these three are the only genuinely new queries
  // the hold/resume feature needs (list-with-visibility-filter, toggle,
  // soft-delete-on-cancel).
  async findHeldOrders(tenant: TenantContext, branchId: string, actorId: string) {
    let query = this.supabase
      .from('orders')
      .select(this.ORDER_SELECT)
      .eq('held', true)
      .is('deleted_at', null)
      .eq('branch_id', branchId)
      .or(`held_visibility.eq.all_cashiers,held_by.eq.${actorId}`);

    if (tenant.tenantId) {
      query = query.eq('tenant_id', tenant.tenantId);
    }

    const { data, error } = await query.order('held_at', { ascending: false });
    if (error) throw error;

    return (data ?? []).map((o: any) => ({
      ...o,
      cashier_name: (o.cashier as any)?.name ?? null,
      customer_name: (o.customer as any)?.full_name ?? null,
      cashier: undefined,
      customer: undefined,
    }));
  }

  async updateHeldVisibility(tenant: TenantContext, id: string, visibility: string) {
    const query = this.supabase
      .from('orders')
      .update({ held_visibility: visibility })
      .eq('id', id)
      .eq('held', true);

    const scoped = tenant.tenantId ? query.eq('tenant_id', tenant.tenantId) : query;
    const { data, error } = await scoped.select('id, held_visibility').maybeSingle();
    if (error) throw error;
    return data;
  }

  async cancelHeldOrder(tenant: TenantContext, id: string) {
    const query = this.supabase
      .from('orders')
      .update({ deleted_at: new Date().toISOString(), held: false })
      .eq('id', id)
      .eq('held', true);

    const scoped = tenant.tenantId ? query.eq('tenant_id', tenant.tenantId) : query;
    const { data, error } = await scoped.select('id').maybeSingle();
    if (error) throw error;
    return data;
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