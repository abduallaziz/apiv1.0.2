import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../../../shared/supabase/supabase.module';
import { SupabaseClient } from '@supabase/supabase-js';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';
import { TenantContext } from '../../../core/tenant/tenant-context';
import { TenantSessionService } from '../../../core/tenant/tenant-session.service';
import { PaginationDto } from '../../../shared/dto/pagination.dto';
import { isForeignKeyViolation } from '../../../shared/supabase/postgrest-error.util';

export interface PooledInvoiceItem {
  item_id: string;
  item_name: string;
  variant_id?: string | null;
  variant_name?: string | null;
  quantity: number;
  unit_price: number;
  // D01-M7 — official catalog price at sale time, for every new order_item
  // (Normal Sale or Override alike). Never NULL for a new row; the 380
  // pre-D01 legacy rows remain NULL permanently and are untouched here.
  official_price_snapshot: number;
  // D01-M7 — present only for an approved Price Override line. Written to
  // price_override_audit inside the same transaction as its order_item,
  // using that row's real (returned) id — never for a Normal Sale line.
  override?: PooledOverrideAudit;
}

export interface PooledOverrideAudit {
  actor_role_id: string;
  actor_role_name_snapshot: string;
  official_unit_price: number;
  approved_unit_price: number;
  difference_amount: number;
  difference_percent: number;
  direction: 'discount' | 'increase';
  reason: string | null;
  effective_policy_snapshot: object;
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
           tenant_id, branch_id, shift_id, cashier_id, customer_id, status,
           subtotal, discount, tax, total, payment_method, notes,
           coupon_code, sale_attempt_id, cash_amount, card_amount
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         RETURNING id`,
        [
          tenant.tenantId,
          orderPayload.branch_id,
          orderPayload.shift_id ?? null,
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
          orderPayload.sale_attempt_id,
          orderPayload.cash_amount ?? null,
          orderPayload.card_amount ?? null,
        ],
      );
      const orderId = orderResult.rows[0].id;

      // D01-M7 — same transaction as the order insert above (no separate
      // BEGIN/COMMIT): order_item.id is only known after RETURNING, and
      // price_override_audit.order_item_id is NOT NULL, so the audit insert
      // for an override line must happen right after its own order_item
      // insert, still inside this callback, before the outer runInTenantContext
      // COMMIT. Any failure at any point — order, any order_item, any audit —
      // rolls back everything via that same outer BEGIN/COMMIT/ROLLBACK.
      for (const item of items) {
        const itemResult = await client.query<{ id: string }>(
          `INSERT INTO order_items (
             order_id, item_id, item_name, qty, price, total_price,
             variant_id, variant_name, official_price_snapshot
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id`,
          [
            orderId,
            item.item_id,
            item.item_name,
            item.quantity,
            item.unit_price,
            Number(item.quantity) * Number(item.unit_price),
            item.variant_id ?? null,
            item.variant_name ?? null,
            item.official_price_snapshot,
          ],
        );
        const orderItemId = itemResult.rows[0].id;

        if (item.override) {
          await client.query(
            `INSERT INTO price_override_audit (
               tenant_id, branch_id, order_id, order_item_id, actor_id,
               actor_role_id, actor_role_name_snapshot, item_id,
               official_unit_price, approved_unit_price, difference_amount,
               difference_percent, direction, reason, effective_policy_snapshot
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
            [
              tenant.tenantId,
              orderPayload.branch_id,
              orderId,
              orderItemId,
              orderPayload.cashier_id,
              item.override.actor_role_id,
              item.override.actor_role_name_snapshot,
              item.item_id,
              item.override.official_unit_price,
              item.override.approved_unit_price,
              item.override.difference_amount,
              item.override.difference_percent,
              item.override.direction,
              item.override.reason,
              JSON.stringify(item.override.effective_policy_snapshot),
            ],
          );
        }
      }

      // M184 — Sales Posting, same transaction, after every order_item/
      // audit insert above (so it can never post before the sale itself
      // is fully written) and before the outer COMMIT. Any failure here
      // — missing branch assignment, closed fiscal period, unrecognized
      // payment method, unbalanced totals — rolls back the entire sale
      // via the same BEGIN/COMMIT/ROLLBACK this callback already runs
      // inside. No best-effort accounting: a sale is never committed
      // without its journal entry, per the approved M184 design.
      await client.query('SELECT fn_post_sales_order($1, $2, $3, $4)', [
        tenant.tenantId,
        orderId,
        orderPayload.cashier_id,
        null, // p_posting_date — function defaults to orders.created_at::date
      ]);

      return { id: orderId };
    });
  }

  /**
   * M184 — pooled, atomic equivalent of `cancel()` that also reverses the
   * order's Accounting posting (if one exists) in the same transaction.
   * Gated behind `POOLED_INVOICE_WRITES_ENABLED` in `InvoicesService.cancel()`
   * — mirrors `createWithItemsPooled()`'s own gating exactly, since a sale
   * can only have been posted in the first place via that same pooled path.
   */
  async cancelPooled(
    tenant: TenantContext,
    id: string,
    cancelledBy: string,
  ): Promise<{ id: string; status: string }> {
    return this.tenantSession.runInTenantContext(tenant, async (client) => {
      const result = await client.query<{ id: string; status: string }>(
        `UPDATE orders SET status = 'cancelled' WHERE id = $1 AND tenant_id = $2
         RETURNING id, status`,
        [id, tenant.tenantId],
      );
      if (result.rows.length === 0) {
        throw new NotFoundException('Order not found');
      }

      try {
        await client.query(
          'SELECT fn_reverse_sales_order($1, $2, $3, $4, $5)',
          [
            tenant.tenantId,
            id,
            cancelledBy,
            new Date().toISOString().slice(0, 10),
            'Order cancelled',
          ],
        );
      } catch (err: any) {
        // M184 approved behavior: only the specific "nothing to reverse"
        // case (order was never posted — e.g. created before this
        // integration existed, or posting itself never happened) is
        // swallowed. Any other error (real DB failure, posting
        // corruption, closed period on the reversal date) propagates
        // and rolls back the whole cancellation — never a silent
        // Order=cancelled / Journal=untouched-but-broken divergence.
        const message =
          err && typeof err === 'object' && 'message' in err
            ? String((err as { message: unknown }).message)
            : String(err);
        if (!message.includes('nothing to reverse')) {
          throw err;
        }
      }

      return result.rows[0];
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
    // الطلبات المعلقة المحذوفة (استُؤنفت في الكاشير أو حذفها المستخدم من شاشة
    // الطلبات المعلقة) تُعلَّم بـ deleted_at ويبقى status='pending' كما هو — بدون
    // هذا الفلتر تظل ظاهرة هنا كصفوف "معلقة" رغم حذفها، ومزدوجة مع الفاتورة
    // المكتملة التي نتجت عن استئنافها.
    let query = this.ordersQuery(tenant)
      .select(this.ORDER_SELECT)
      .is('deleted_at', null);

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
      cashier_name: o.cashier?.name ?? null,
      customer_name: o.customer?.full_name ?? null,
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
      cashier_name: o.cashier?.name ?? null,
      customer_name: o.customer?.full_name ?? null,
      cashier: undefined,
      customer: undefined,
      items: items ?? [],
    };
  }

  // M187 idempotency guard — looked up once at the start of a create()
  // call (short-circuits before any side effect for a genuine resubmit)
  // and again on a unique-violation race (two concurrent requests with the
  // same sale_attempt_id).
  async findBySaleAttemptId(tenant: TenantContext, saleAttemptId: string) {
    const { data, error } = await this.ordersQuery(tenant)
      .select('id, status, total, payment_method')
      .eq('sale_attempt_id', saleAttemptId)
      .maybeSingle();

    if (error) throw error;
    return data;
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

  // D01-M7 — official_price_snapshot added (populated for every new row,
  // Normal Sale included — never NULL going forward, unlike the 380 legacy
  // pre-D01 rows). .select('id') added so callers can attach
  // price_override_audit rows to the real order_item.id — Postgres
  // preserves row order for a single multi-row INSERT...VALUES...RETURNING,
  // so the returned array lines up 1:1 with the input `items` array order.
  // This non-pooled path only ever receives Normal Sale lines in practice
  // (InvoicesService rejects any invoice containing an approved Override
  // before reaching here unless the pooled path is available — see
  // createWithItemsPooled for the Override+Audit path), but the snapshot
  // column is written here regardless, since Normal Sale needs it too.
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
      official_price_snapshot: item.official_price_snapshot,
    }));

    const { data, error } = await this.supabase
      .from('order_items')
      .insert(mapped)
      .select('id');
    if (error) {
      if (isForeignKeyViolation(error))
        throw new NotFoundException('Unknown item_id or variant_id');
      throw error;
    }
    return (data ?? []).map((row) => row.id as string);
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
    const { error } = await this.supabase.rpc(
      'fn_process_sale_stock_deduction',
      {
        p_tenant_id: tenantId,
        p_warehouse_id: warehouseId,
        p_order_id: orderId,
        p_actor_id: actorId,
        p_items: items,
      },
    );
    if (error) throw error;
  }

  async reverseSaleStockDeduction(
    tenantId: string,
    orderId: string,
    actorId: string,
  ): Promise<void> {
    const { error } = await this.supabase.rpc(
      'fn_reverse_sale_stock_deduction',
      {
        p_tenant_id: tenantId,
        p_order_id: orderId,
        p_actor_id: actorId,
      },
    );
    if (error) throw error;
  }

  // Held-orders: reuses create()/insertItems()/findById() above for the
  // actual insert/fetch — these three are the only genuinely new queries
  // the hold/resume feature needs (list-with-visibility-filter, toggle,
  // soft-delete-on-cancel).
  async findHeldOrders(
    tenant: TenantContext,
    branchId: string,
    actorId: string,
  ) {
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
      cashier_name: o.cashier?.name ?? null,
      customer_name: o.customer?.full_name ?? null,
      cashier: undefined,
      customer: undefined,
    }));
  }

  async updateHeldVisibility(
    tenant: TenantContext,
    id: string,
    visibility: string,
  ) {
    const query = this.supabase
      .from('orders')
      .update({ held_visibility: visibility })
      .eq('id', id)
      .eq('held', true);

    const scoped = tenant.tenantId
      ? query.eq('tenant_id', tenant.tenantId)
      : query;
    const { data, error } = await scoped
      .select('id, held_visibility')
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async cancelHeldOrder(tenant: TenantContext, id: string) {
    const query = this.supabase
      .from('orders')
      .update({ deleted_at: new Date().toISOString(), held: false })
      .eq('id', id)
      .eq('held', true);

    const scoped = tenant.tenantId
      ? query.eq('tenant_id', tenant.tenantId)
      : query;
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
