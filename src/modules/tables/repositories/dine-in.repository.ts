import { Injectable, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../../shared/supabase/supabase.module';
import { TenantSessionService } from '../../../core/tenant/tenant-session.service';
import { TenantContext } from '../../../core/tenant/tenant-context';
import { DineInItemRow, DineInOrderRow } from '../tables.types';

@Injectable()
export class DineInRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
    private readonly tenantSession: TenantSessionService,
  ) {}

  async findOpenOrderByTable(tenantId: string, tableId: string) {
    const { data, error } = await this.supabase
      .from('orders')
      .select(
        'id, branch_id, cashier_id, table_id, subtotal, discount, tax, total, status, created_at',
      )
      .eq('tenant_id', tenantId)
      .eq('table_id', tableId)
      .eq('status', 'pending')
      .maybeSingle<DineInOrderRow>();
    if (error) throw error;
    return data;
  }

  /**
   * Atomic via fn_open_dine_in_table — checks the table is available, flips it to
   * occupied, and creates the order in one Postgres transaction. Replaces the old
   * two-step create-order-then-update-table sequence, where a failure between the
   * two left the table and its order permanently disagreeing about state (the root
   * cause of the "No open order for this table" incident — STATUS.md §77/§78).
   * Raises a Postgres exception (caught by the service and re-thrown as the
   * matching HTTP error) if the table doesn't exist or isn't available.
   */
  async openTableAtomic(
    tenantId: string,
    tableId: string,
    branchId: string,
    cashierId: string,
  ) {
    const res = await this.supabase.rpc('fn_open_dine_in_table', {
      p_tenant_id: tenantId,
      p_table_id: tableId,
      p_branch_id: branchId,
      p_cashier_id: cashierId,
    });
    if (res.error) throw res.error;
    return (res.data as DineInOrderRow[] | null)?.[0] ?? null;
  }

  /** True only if the customer exists in this tenant (not soft-deleted). */
  async customerBelongsToTenant(
    tenantId: string,
    customerId: string,
  ): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('customers')
      .select('id')
      .eq('id', customerId)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw error;
    return !!data;
  }

  /**
   * Finalizes the order + frees the table via fn_checkout_dine_in_table AND takes
   * the sequential legal invoice number (fn_next_invoice_no) in ONE transaction,
   * exactly like the POS path: a failure rolls the counter back (no gaps) and
   * concurrent checkouts are serialised by the counter's row lock (no duplicates).
   */
  async checkoutAtomic(
    tenant: TenantContext,
    orderId: string,
    tableId: string,
    paymentMethod: string,
    customerId: string | null,
    invoiceNumber: { prefix: string; padding: number },
  ): Promise<{ id: string; invoice_no: string } | null> {
    return this.tenantSession.runInTenantContext(tenant, async (client) => {
      const done = await client.query<{ id: string }>(
        'SELECT id FROM fn_checkout_dine_in_table($1, $2, $3, $4, $5)',
        [tenant.tenantId, orderId, tableId, paymentMethod, customerId],
      );
      if (done.rows.length === 0) return null;
      const n = await client.query<{ no: string }>(
        'SELECT fn_next_invoice_no($1, $2, $3) AS no',
        [tenant.tenantId, invoiceNumber.prefix, invoiceNumber.padding],
      );
      const invoiceNo = n.rows[0].no;
      await client.query(
        'UPDATE orders SET invoice_no = $3 WHERE id = $1 AND tenant_id = $2',
        [orderId, tenant.tenantId, invoiceNo],
      );
      return { id: orderId, invoice_no: invoiceNo };
    });
  }

  /**
   * Releases a table that was opened by mistake: cancels its still-EMPTY pending
   * order and frees the table in one transaction. Returns false if there is no
   * open order, or the order already has items (then it must be checked out).
   */
  async releaseEmptyTable(
    tenant: TenantContext,
    tableId: string,
    cancelledBy: string,
  ): Promise<'released' | 'no_open_order' | 'has_items'> {
    return this.tenantSession.runInTenantContext(tenant, async (client) => {
      const o = await client.query<{ id: string }>(
        `SELECT id FROM orders
          WHERE tenant_id = $1 AND table_id = $2 AND status = 'pending'
          FOR UPDATE`,
        [tenant.tenantId, tableId],
      );
      if (o.rows.length === 0) return 'no_open_order';
      const orderId = o.rows[0].id;
      const items = await client.query(
        'SELECT 1 FROM order_items WHERE order_id = $1 AND deleted_at IS NULL LIMIT 1',
        [orderId],
      );
      if (items.rows.length > 0) return 'has_items';
      await client.query(
        `UPDATE orders SET status = 'cancelled', cancelled_at = now(),
                cancelled_by = $3, cancel_reason = 'Table released (opened by mistake)'
          WHERE id = $1 AND tenant_id = $2`,
        [orderId, tenant.tenantId, cancelledBy],
      );
      await client.query(
        `UPDATE tables SET status = 'available' WHERE id = $1 AND tenant_id = $2`,
        [tableId, tenant.tenantId],
      );
      return 'released';
    });
  }

  async insertItems(
    orderId: string,
    tenantId: string,
    items: {
      item_id: string;
      item_name: string;
      variant_id?: string | null;
      variant_name?: string | null;
      quantity: number;
      unit_price: number;
    }[],
  ) {
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
      .select(
        'id, item_id, item_name, qty, price, total_price, variant_id, variant_name, kitchen_status, created_at',
      )
      .eq('order_id', orderId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []) as DineInItemRow[];
  }

  async updateOrderTotals(
    orderId: string,
    tenantId: string,
    totals: { subtotal: number; discount: number; tax: number; total: number },
  ) {
    const { error } = await this.supabase
      .from('orders')
      .update(totals)
      .eq('id', orderId)
      .eq('tenant_id', tenantId);
    if (error) throw error;
  }

  /**
   * Soft-deletes an item from an open order. Scoped to both the specific order (not
   * just "any item with this id") and the tenant, verified via a SELECT first (same
   * join pattern as updateItemKitchenStatus below — order_items has no tenant_id
   * column of its own) since PostgREST update filters can't reliably reach through
   * an embedded relation. Returns null if the item doesn't exist, belongs to a
   * different order/tenant, or was already removed.
   */
  async removeItem(itemId: string, orderId: string, tenantId: string) {
    const { data: item, error: findErr } = await this.supabase
      .from('order_items')
      .select('id, deleted_at, orders!inner(tenant_id)')
      .eq('id', itemId)
      .eq('order_id', orderId)
      .eq('orders.tenant_id', tenantId)
      .maybeSingle();
    if (findErr) throw findErr;
    if (!item || item.deleted_at) return null;

    const { error } = await this.supabase
      .from('order_items')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', itemId);
    if (error) throw error;
    return true;
  }

  async updateItemKitchenStatus(
    itemId: string,
    tenantId: string,
    status: string,
  ) {
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
