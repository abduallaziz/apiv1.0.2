import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';

@Injectable()
export class ShiftsRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async findAll(tenantId: string | null, branchId?: string) {
    let query = this.supabase
      .from('shifts')
      .select(
        'id, status, opening_cash, closing_cash, discrepancy, expected_cash, opened_at, closed_at, cashier_id, branch_id, users!cashier_id(name)',
      )
      .is('deleted_at', null)
      .order('opened_at', { ascending: false });

    if (tenantId) query = query.eq('tenant_id', tenantId);
    if (branchId) query = query.eq('branch_id', branchId);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data ?? []).map((s: any) => ({
      ...s,
      cashier_name: s.users?.name ?? null,
      users: undefined,
    }));
  }

  async findOpenByUser(cashierId: string, tenantId: string) {
    const { data } = await this.supabase
      .from('shifts')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('cashier_id', cashierId)
      .eq('status', 'open')
      .is('deleted_at', null)
      .maybeSingle();
    return data;
  }

  async findById(id: string, tenantId: string) {
    const { data } = await this.supabase
      .from('shifts')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle();
    return data;
  }

  async create(payload: {
    tenant_id: string;
    branch_id: string;
    cashier_id: string;
    opening_cash: number;
    notes?: string;
  }) {
    const { data, error } = await this.supabase
      .from('shifts')
      .insert({
        ...payload,
        status: 'open',
        opened_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  // The register is closed by ONE database function (fn_close_shift, migration
  // 254): it locks the register, verifies the activity fingerprint and writes
  // the closing + the per-method counts in a single transaction.
  async closeAtomic(params: {
    tenantId: string;
    shiftId: string;
    closedBy: string;
    closingCash: number;
    expectedCash: number;
    discrepancy: number;
    notes: string | null;
    closedAt: string;
    report: unknown;
    counts: {
      payment_method: string;
      counted: number;
      expected: number;
      difference: number;
    }[];
    fingerprint: {
      orders: number;
      ordersTotal: number;
      returns: number;
      returnsTotal: number;
    };
  }) {
    const { data, error } = await this.supabase.rpc('fn_close_shift', {
      p_tenant_id: params.tenantId,
      p_shift_id: params.shiftId,
      p_closed_by: params.closedBy,
      p_closing_cash: params.closingCash,
      p_expected_cash: params.expectedCash,
      p_discrepancy: params.discrepancy,
      p_notes: params.notes,
      p_closed_at: params.closedAt,
      p_report: params.report,
      p_counts: params.counts,
      p_expect_orders: params.fingerprint.orders,
      p_expect_orders_total: params.fingerprint.ordersTotal,
      p_expect_returns: params.fingerprint.returns,
      p_expect_returns_total: params.fingerprint.returnsTotal,
    });
    if (error) throw error;
    return data;
  }

  async getShiftOrderExtras(shiftId: string, tenantId: string) {
    // Completed orders of the shift with the discount/tax columns, their
    // items count, and the cancelled orders (count + amount) of the shift.
    const { data: completed } = await this.supabase
      .from('orders')
      .select('id, discount, tax')
      .eq('shift_id', shiftId)
      .eq('tenant_id', tenantId)
      .eq('status', 'completed');
    const ids = (completed ?? []).map((o: { id: string }) => o.id);

    let itemsCount = 0;
    if (ids.length) {
      const { data: items } = await this.supabase
        .from('order_items')
        .select('qty')
        .in('order_id', ids)
        .is('deleted_at', null);
      itemsCount = (items ?? []).reduce(
        (sum: number, i: { qty: number }) => sum + Number(i.qty ?? 0),
        0,
      );
    }

    const { data: cancelled } = await this.supabase
      .from('orders')
      .select('total')
      .eq('shift_id', shiftId)
      .eq('tenant_id', tenantId)
      .eq('status', 'cancelled');

    return {
      discountTotal: (completed ?? []).reduce(
        (s: number, o: { discount: number | null }) =>
          s + Number(o.discount ?? 0),
        0,
      ),
      taxTotal: (completed ?? []).reduce(
        (s: number, o: { tax: number | null }) => s + Number(o.tax ?? 0),
        0,
      ),
      itemsCount,
      cancelled: {
        count: (cancelled ?? []).length,
        amount: (cancelled ?? []).reduce(
          (s: number, o: { total: number | null }) =>
            s + Number(o.total ?? 0),
          0,
        ),
      },
    };
  }

  async getTenantMeta(tenantId: string) {
    const { data } = await this.supabase
      .from('tenants')
      .select('timezone, currency')
      .eq('id', tenantId)
      .maybeSingle();
    const row = data as { timezone?: string; currency?: string } | null;
    return {
      timezone: row?.timezone ?? 'Asia/Riyadh',
      currency: row?.currency ?? 'SAR',
    };
  }

  async getNames(tenantId: string, cashierId: string, branchId: string) {
    const { data: user } = await this.supabase
      .from('users')
      .select('name')
      .eq('id', cashierId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    const { data: branch } = await this.supabase
      .from('branches')
      .select('name')
      .eq('id', branchId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    return {
      cashierName: (user as { name?: string } | null)?.name ?? null,
      branchName: (branch as { name?: string } | null)?.name ?? null,
    };
  }

  async getShiftInvoices(shiftId: string, tenantId: string) {
    // M189: cash_amount/card_amount added (M188) so ShiftEngine can bucket
    // a split-payment order's real cash/card portions instead of missing
    // it entirely. NULL for every non-split order (M188's own guarantee).
    const { data } = await this.supabase
      .from('orders')
      .select('total, payment_method, cash_amount, card_amount')
      .eq('shift_id', shiftId)
      .eq('tenant_id', tenantId)
      .eq('status', 'completed');
    return data ?? [];
  }

  // Phase 3b: refunds paid out of this register session (sales returns
  // whose shift_id is this shift).
  async getShiftReturns(shiftId: string, tenantId: string) {
    const { data } = await this.supabase
      .from('sales_returns')
      .select('refund_method, refund_cash, refund_noncash, refund_total')
      .eq('shift_id', shiftId)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null);
    return data ?? [];
  }

  // Phase 5 / T8 (owner approved 2026-11-09): the cash expenses taken out of
  // THIS register, from expenses_v2 (the module the owner uses). Only PAID,
  // approved, non-cancelled CASH expenses linked to the shift; the amount is
  // the CASH that left the drawer, i.e. total_amount (VAT included), not the
  // before-VAT figure the reports use.
  async getShiftExpenses(shiftId: string, tenantId: string) {
    const { data } = await this.supabase
      .from('expenses_v2')
      .select('total_amount, approval_status, payment_method, payment_status')
      .eq('shift_id', shiftId)
      .eq('tenant_id', tenantId)
      .eq('payment_status', 'paid')
      .is('cancelled_at', null)
      .in('approval_status', ['approved', 'accepted']);
    return (data ?? [])
      .filter(
        (e: { payment_method: string | null }) =>
          (e.payment_method ?? '').trim().toLowerCase() === 'cash',
      )
      .map((e: { total_amount: number }) => ({
        amount: Number(e.total_amount),
        status: 'approved',
      }));
  }

  async findCurrentByBranch(branchId: string, tenantId: string) {
    const { data } = await this.supabase
      .from('shifts')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('branch_id', branchId)
      .eq('status', 'open')
      .is('deleted_at', null)
      .order('opened_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return data;
  }
}
