import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';

export interface SalesReturnResult {
  dry_run: boolean;
  id?: string;
  net_amount: number;
  tax_amount: number;
  refund_total: number;
  refund_cash: number;
  refund_noncash: number;
  refund_method: string;
  journal_entry_id?: string | null;
  lines: {
    order_item_id: string;
    item_name: string;
    quantity: number;
    unit_value: number;
    line_value: number;
  }[];
}

@Injectable()
export class SalesReturnsRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  // The whole return (validation, rows, stock, journal entry) runs inside
  // the single database function fn_create_sales_return - one transaction,
  // so it is never half recorded. p_dry_run computes without writing.
  async callCreate(params: {
    tenantId: string;
    orderId: string;
    actorId: string;
    shiftId: string | null;
    reason: string | null;
    items: { order_item_id: string; quantity: number }[];
    dryRun: boolean;
  }): Promise<SalesReturnResult> {
    const { data, error } = await this.supabase.rpc('fn_create_sales_return', {
      p_tenant_id: params.tenantId,
      p_order_id: params.orderId,
      p_actor_id: params.actorId,
      p_shift_id: params.shiftId,
      p_reason: params.reason,
      p_items: params.items,
      p_dry_run: params.dryRun,
    });
    if (error) throw error;
    return data as SalesReturnResult;
  }

  async findOpenShiftId(
    tenantId: string,
    cashierId: string,
  ): Promise<string | null> {
    const { data } = await this.supabase
      .from('shifts')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('cashier_id', cashierId)
      .eq('status', 'open')
      .is('deleted_at', null)
      .order('opened_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data as { id: string } | null)?.id ?? null;
  }

  // Order lines with how much of each is still returnable, plus the
  // returns already made on the order.
  async getOrderReturnInfo(tenantId: string, orderId: string) {
    const { data: order } = await this.supabase
      .from('orders')
      .select('id, status, total, payment_method')
      .eq('id', orderId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (!order) return null;

    const { data: items } = await this.supabase
      .from('order_items')
      .select('id, item_name, qty, price, total_price, variant_name')
      .eq('order_id', orderId)
      .is('deleted_at', null);

    const { data: returns } = await this.supabase
      .from('sales_returns')
      .select(
        'id, created_at, reason, refund_method, refund_total, refund_cash, refund_noncash, sales_return_items(order_item_id, item_name, quantity)',
      )
      .eq('tenant_id', tenantId)
      .eq('order_id', orderId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    const returnedByItem = new Map<string, number>();
    for (const r of returns ?? []) {
      const lines =
        (
          r as {
            sales_return_items?: { order_item_id: string; quantity: number }[];
          }
        ).sales_return_items ?? [];
      for (const ri of lines) {
        returnedByItem.set(
          ri.order_item_id,
          (returnedByItem.get(ri.order_item_id) ?? 0) + Number(ri.quantity),
        );
      }
    }

    return {
      order,
      items: (items ?? []).map((i) => {
        const row = i as {
          id: string;
          item_name: string;
          qty: number;
          total_price: number;
          variant_name: string | null;
        };
        const returned = returnedByItem.get(row.id) ?? 0;
        return {
          order_item_id: row.id,
          item_name: row.item_name,
          variant_name: row.variant_name,
          quantity: Number(row.qty),
          unit_value: Number(row.total_price) / Number(row.qty || 1),
          returned_quantity: returned,
          returnable_quantity: Number(row.qty) - returned,
        };
      }),
      returns: returns ?? [],
    };
  }

  async countReturns(tenantId: string, orderId: string): Promise<number> {
    const { count } = await this.supabase
      .from('sales_returns')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('order_id', orderId)
      .is('deleted_at', null);
    return count ?? 0;
  }
}
