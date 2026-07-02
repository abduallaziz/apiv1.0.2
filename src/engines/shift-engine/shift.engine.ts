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
    invoices: { total: number; payment_method: string }[];
    expenses: { amount: number; status: string }[];
  }): ShiftSummary {
    const { openingCash, closingCash, invoices, expenses } = params;

    const totalInvoices = invoices.length;
    const totalRevenue = invoices.reduce((sum, inv) => sum + Number(inv.total), 0);
    const totalCash = invoices
      .filter((inv) => inv.payment_method === 'cash')
      .reduce((sum, inv) => sum + Number(inv.total), 0);
    const totalCard = invoices
      .filter((inv) => inv.payment_method === 'card')
      .reduce((sum, inv) => sum + Number(inv.total), 0);
    const totalExpenses = expenses
      .filter((e) => e.status === 'approved')
      .reduce((sum, e) => sum + Number(e.amount), 0);

    const expectedCash = this.calculateExpectedCash(openingCash, totalCash, totalExpenses);
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