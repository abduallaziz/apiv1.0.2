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
  ): number {
    return openingCash + totalCash - totalCashExpenses;
  }

  reconcileCash(counted: number, expected: number): CashReconciliation {
    return {
      counted,
      system: expected,
      discrepancy: counted - expected,
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
  }): ShiftSummary {
    const { openingCash, closingCash, invoices, expenses } = params;

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
    const totalCard = invoices.reduce((sum, inv) => {
      if (inv.payment_method === 'card') return sum + Number(inv.total);
      if (inv.payment_method === 'split')
        return sum + Number(inv.card_amount ?? 0);
      return sum;
    }, 0);
    const totalExpenses = expenses
      .filter((e) => e.status === 'approved')
      .reduce((sum, e) => sum + Number(e.amount), 0);

    const expectedCash = this.calculateExpectedCash(
      openingCash,
      totalCash,
      totalExpenses,
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
    };
  }
}
