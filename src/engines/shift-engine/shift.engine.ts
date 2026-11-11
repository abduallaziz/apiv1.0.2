import { Injectable, BadRequestException } from '@nestjs/common';

export interface ShiftSummary {
  totalInvoices: number;
  totalRevenue: number;
  totalCash: number;
  totalCard: number;
  totalExpenses: number;
  openingCash: number;
  closingCash: number;
  expectedCash: number;
  discrepancy: number;
  byMethod: Record<string, number>;
  // Phase 3b: refunds paid in this register session (sales returns).
  totalReturnsCash: number;
  totalReturnsNoncash: number;
  returnedCount: number;
  returnedAmount: number;
  // Non-cash refunds per refund method; a split order's card share is
  // reported under 'split_card' (same naming as byMethod).
  returnsByMethod: Record<string, number>;
}

export interface ShiftReturnInput {
  refund_method: string;
  refund_cash: number | null;
  refund_noncash: number | null;
  refund_total: number | null;
}

// Phase 2 (owner approved 2026-11-09): the methods the cashier counts at
// close. Every other non-cash method (wallet, apple_pay, stc_pay, the
// card share of a split order, ...) is reported as one expected-only
// "other" row, so the per-method rows always add up to total sales.
export const COUNTED_METHODS = ['cash', 'mada', 'visa', 'mastercard'] as const;
export type CountedMethod = (typeof COUNTED_METHODS)[number];

export interface CloseReportRow {
  method: CountedMethod | 'other';
  sales: number;
  returns: number;
  expected: number;
  counted: number | null;
  difference: number | null;
}

export interface CloseReport {
  revision: number;
  legacy: boolean;
  generated_at: string;
  shift: {
    id: string;
    opened_at: string;
    closed_at: string;
    cashier_id: string;
    cashier_name: string | null;
    branch_id: string;
    branch_name: string | null;
    notes: string | null;
  };
  totals: {
    invoice_count: number;
    items_count: number;
    total_sales: number;
    discount_total: number;
    tax_total: number;
    expenses_total: number;
    cancelled_count: number;
    cancelled_amount: number;
    returned_count: number;
    returned_amount: number;
  };
  cash: {
    opening: number;
    expected: number;
    counted: number;
    difference: number;
  };
  methods: CloseReportRow[];
}

export interface CashReconciliation {
  counted: number;
  system: number;
  discrepancy: number;
}

@Injectable()
export class ShiftEngine {
  validateNoDoubleShift(existingOpenShift: boolean): void {
    if (existingOpenShift) {
      throw new BadRequestException('A shift is already open for this cashier');
    }
  }

  calculateExpectedCash(
    openingCash: number,
    totalCash: number,
    totalCashExpenses: number,
    totalCashReturns = 0,
  ): number {
    return openingCash + totalCash - totalCashExpenses - totalCashReturns;
  }

  reconcileCash(counted: number, expected: number): CashReconciliation {
    return {
      counted,
      system: expected,
      discrepancy: counted - expected,
    };
  }

  private r2(n: number): number {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  // Builds the immutable close report from the shift summary and the
  // cashier's counts. `counts` missing a method counts as 0 (the blind
  // count UI always sends all four fields; a blank field means nothing
  // was counted for it).
  buildCloseReport(params: {
    summary: ShiftSummary;
    counts: Partial<Record<CountedMethod, number>>;
    shift: CloseReport['shift'];
    itemsCount: number;
    discountTotal: number;
    taxTotal: number;
    cancelled: { count: number; amount: number };
    revision?: number;
    legacy?: boolean;
    generatedAt?: string;
  }): CloseReport {
    const { summary, counts, shift } = params;
    const by = summary.byMethod;
    const cashCounted = this.r2(Number(counts.cash ?? 0));
    const ret = summary.returnsByMethod ?? {};
    const returnsByMethod: Record<CountedMethod, number> = {
      cash: this.r2(summary.totalReturnsCash ?? 0),
      mada: this.r2(ret.mada ?? 0),
      visa: this.r2(ret.visa ?? 0),
      mastercard: this.r2(ret.mastercard ?? 0),
    };
    const expectedByMethod: Record<CountedMethod, number> = {
      cash: this.r2(summary.expectedCash),
      mada: this.r2((by.mada ?? 0) - returnsByMethod.mada),
      visa: this.r2((by.visa ?? 0) - returnsByMethod.visa),
      mastercard: this.r2(
        (by.mastercard ?? 0) - returnsByMethod.mastercard,
      ),
    };
    const salesByMethod: Record<CountedMethod, number> = {
      cash: this.r2(summary.totalCash),
      mada: this.r2(by.mada ?? 0),
      visa: this.r2(by.visa ?? 0),
      mastercard: this.r2(by.mastercard ?? 0),
    };

    const methods: CloseReportRow[] = COUNTED_METHODS.map((m) => {
      const counted = this.r2(Number(counts[m] ?? 0));
      return {
        method: m,
        sales: salesByMethod[m],
        returns: returnsByMethod[m],
        expected: expectedByMethod[m],
        counted,
        difference: this.r2(counted - expectedByMethod[m]),
      };
    });

    const countedSales =
      salesByMethod.cash +
      salesByMethod.mada +
      salesByMethod.visa +
      salesByMethod.mastercard;
    const otherSales = this.r2(summary.totalRevenue - countedSales);
    // Non-cash refunds that belong to no counted method (wallet, apple_pay,
    // stc_pay, the card share of a split order ...).
    const otherReturns = this.r2(
      (summary.totalReturnsNoncash ?? 0) -
        returnsByMethod.mada -
        returnsByMethod.visa -
        returnsByMethod.mastercard,
    );
    methods.push({
      method: 'other',
      sales: otherSales,
      returns: otherReturns,
      expected: this.r2(otherSales - otherReturns),
      counted: null,
      difference: null,
    });

    return {
      revision: params.revision ?? 1,
      legacy: params.legacy ?? false,
      generated_at: params.generatedAt ?? new Date().toISOString(),
      shift,
      totals: {
        invoice_count: summary.totalInvoices,
        items_count: params.itemsCount,
        total_sales: this.r2(summary.totalRevenue),
        discount_total: this.r2(params.discountTotal),
        tax_total: this.r2(params.taxTotal),
        expenses_total: this.r2(summary.totalExpenses),
        cancelled_count: params.cancelled.count,
        cancelled_amount: this.r2(params.cancelled.amount),
        returned_count: summary.returnedCount ?? 0,
        returned_amount: this.r2(summary.returnedAmount ?? 0),
      },
      cash: {
        opening: this.r2(summary.openingCash),
        expected: expectedByMethod.cash,
        counted: cashCounted,
        difference: this.r2(cashCounted - expectedByMethod.cash),
      },
      methods,
    };
  }

  buildShiftSummary(params: {
    openingCash: number;
    closingCash: number;
    invoices: {
      total: number;
      payment_method: string;
      cash_amount?: number | null;
      card_amount?: number | null;
    }[];
    expenses: { amount: number; status: string }[];
    returns?: ShiftReturnInput[];
  }): ShiftSummary {
    const { openingCash, closingCash, invoices, expenses } = params;
    const returns = params.returns ?? [];

    const totalInvoices = invoices.length;
    const totalRevenue = invoices.reduce(
      (sum, inv) => sum + Number(inv.total),
      0,
    );

    // M189: 'cash' and 'card' behave exactly as before (unchanged branches).
    // 'split' contributes its own persisted cash_amount/card_amount instead
    // of the full order total to either bucket — this is what M188 exists
    // for. A historical split order predating M188 has cash_amount/
    // card_amount = NULL (never fabricated — see migration 188); `?? 0`
    // makes it contribute nothing to either bucket rather than throwing or
    // producing NaN, which is exactly its prior (pre-M189) behavior: split
    // orders were never counted in totalCash/totalCard at all.
    // Every other method (wallet/mada/visa/mastercard/stc_pay/apple_pay/
    // tab) is deliberately left untouched — still counted in totalRevenue
    // only, in neither bucket, exactly as before. That ambiguity is
    // pre-existing, not introduced or resolved here (see M189 report §7).
    const totalCash = invoices.reduce((sum, inv) => {
      if (inv.payment_method === 'cash') return sum + Number(inv.total);
      if (inv.payment_method === 'split')
        return sum + Number(inv.cash_amount ?? 0);
      return sum;
    }, 0);
    // Phase 1 (owner approved 2026-11-09, defect N1/S5): every NON-cash
    // method (card, mada, visa, mastercard, wallet, apple_pay, stc_pay, tab,
    // ...) is an electronic payment and belongs in the non-cash bucket, so
    // cash + non-cash = total sales. The split order contributes its own
    // card_amount share exactly as before.
    const totalCard = invoices.reduce((sum, inv) => {
      if (inv.payment_method === 'cash') return sum;
      if (inv.payment_method === 'split')
        return sum + Number(inv.card_amount ?? 0);
      return sum + Number(inv.total);
    }, 0);
    // Per-method breakdown for the close report. A split order is shown
    // under 'split_cash' / 'split_card' (its two persisted shares).
    const byMethod: Record<string, number> = {};
    for (const inv of invoices) {
      if (inv.payment_method === 'split') {
        byMethod.split_cash =
          (byMethod.split_cash ?? 0) + Number(inv.cash_amount ?? 0);
        byMethod.split_card =
          (byMethod.split_card ?? 0) + Number(inv.card_amount ?? 0);
      } else {
        const m = inv.payment_method || 'unknown';
        byMethod[m] = (byMethod[m] ?? 0) + Number(inv.total);
      }
    }
    const totalExpenses = expenses
      .filter((e) => e.status === 'approved')
      .reduce((sum, e) => sum + Number(e.amount), 0);

    // Phase 3b: refunds paid out of this register. Cash refunds leave the
    // drawer (reduce expected cash); non-cash refunds go back to the
    // original method and never touch the drawer.
    const totalReturnsCash = returns.reduce(
      (sum, r) => sum + Number(r.refund_cash ?? 0),
      0,
    );
    const totalReturnsNoncash = returns.reduce(
      (sum, r) => sum + Number(r.refund_noncash ?? 0),
      0,
    );
    const returnedAmount = returns.reduce(
      (sum, r) => sum + Number(r.refund_total ?? 0),
      0,
    );
    const returnsByMethod: Record<string, number> = {};
    for (const r of returns) {
      const noncash = Number(r.refund_noncash ?? 0);
      if (noncash <= 0) continue;
      const key = r.refund_method === 'split' ? 'split_card' : r.refund_method;
      returnsByMethod[key] = (returnsByMethod[key] ?? 0) + noncash;
    }

    const expectedCash = this.calculateExpectedCash(
      openingCash,
      totalCash,
      totalExpenses,
      totalReturnsCash,
    );
    const discrepancy = closingCash - expectedCash;

    return {
      totalInvoices,
      totalRevenue,
      totalCash,
      totalCard,
      totalExpenses,
      openingCash,
      closingCash,
      expectedCash,
      discrepancy,
      byMethod,
      totalReturnsCash,
      totalReturnsNoncash,
      returnedCount: returns.length,
      returnedAmount,
      returnsByMethod,
    };
  }
}
