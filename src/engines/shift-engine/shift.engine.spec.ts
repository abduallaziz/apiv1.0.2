import { ShiftEngine } from './shift.engine';

describe('ShiftEngine.buildShiftSummary (phase 1, defect N1)', () => {
  const engine = new ShiftEngine();

  // Mirrors the runtime test of 2026-11-09: cash 45.42, 3 splits (60.38 total,
  // card share 38.38), 2 mada (11.50), 1 wallet (5.75).
  const invoices = [
    { total: 28.75, payment_method: 'cash' },
    { total: 5.75, payment_method: 'cash' },
    { total: 5.75, payment_method: 'cash' },
    { total: 5.17, payment_method: 'cash' },
    { total: 5.75, payment_method: 'mada' },
    { total: 5.75, payment_method: 'mada' },
    { total: 5.75, payment_method: 'wallet' },
    { total: 28.75, payment_method: 'split', cash_amount: 10, card_amount: 18.75 },
    { total: 25.88, payment_method: 'split', cash_amount: 10, card_amount: 15.88 },
    { total: 5.75, payment_method: 'split', cash_amount: 2, card_amount: 3.75 },
  ];

  const summary = engine.buildShiftSummary({
    openingCash: 0,
    closingCash: 60,
    invoices,
    expenses: [],
  });

  it('cash + non-cash equals total revenue', () => {
    expect(summary.totalRevenue).toBeCloseTo(123.05, 2);
    expect(summary.totalCash + summary.totalCard).toBeCloseTo(
      summary.totalRevenue,
      2,
    );
  });

  it('expected cash is unchanged (cash invoices + cash share of splits)', () => {
    expect(summary.totalCash).toBeCloseTo(67.42, 2);
    expect(summary.expectedCash).toBeCloseTo(67.42, 2);
    expect(summary.discrepancy).toBeCloseTo(-7.42, 2);
  });

  it('non-cash includes mada and wallet (the old 38.38 omitted 17.25)', () => {
    expect(summary.totalCard).toBeCloseTo(55.63, 2);
  });

  it('byMethod lists every method, split shown by its two shares', () => {
    expect(summary.byMethod.mada).toBeCloseTo(11.5, 2);
    expect(summary.byMethod.wallet).toBeCloseTo(5.75, 2);
    expect(summary.byMethod.cash).toBeCloseTo(45.42, 2);
    expect(summary.byMethod.split_cash).toBeCloseTo(22, 2);
    expect(summary.byMethod.split_card).toBeCloseTo(38.38, 2);
  });

  it('a historical split order with NULL shares contributes nothing, no NaN', () => {
    const s = engine.buildShiftSummary({
      openingCash: 0,
      closingCash: 0,
      invoices: [{ total: 10, payment_method: 'split' }],
      expenses: [],
    });
    expect(s.totalCash).toBe(0);
    expect(s.totalCard).toBe(0);
  });
});

describe('ShiftEngine.buildCloseReport (phase 2)', () => {
  const engine = new ShiftEngine();
  const invoices = [
    { total: 28.75, payment_method: 'cash' },
    { total: 5.75, payment_method: 'mada' },
    { total: 5.75, payment_method: 'visa' },
    { total: 5.75, payment_method: 'wallet' },
    { total: 28.75, payment_method: 'split', cash_amount: 10, card_amount: 18.75 },
  ];
  const summary = engine.buildShiftSummary({
    openingCash: 100,
    closingCash: 0,
    invoices,
    expenses: [],
  });
  const shift = {
    id: 's1',
    opened_at: '2026-11-08T21:45:00.000Z',
    closed_at: '2026-11-08T22:11:00.000Z',
    cashier_id: 'u1',
    cashier_name: 'Cashier',
    branch_id: 'b1',
    branch_name: 'Main',
    notes: null,
  };
  const base = {
    summary,
    shift,
    itemsCount: 7,
    discountTotal: 1.5,
    taxTotal: 12.34,
    cancelled: { count: 1, amount: 5.75 },
  };

  it('cash expected = opening + cash sales + cash share of split', () => {
    const r = engine.buildCloseReport({ ...base, counts: { cash: 138.75 } });
    expect(r.cash.expected).toBeCloseTo(138.75, 2); // 100 + 28.75 + 10
    expect(r.cash.counted).toBe(138.75);
    expect(r.cash.difference).toBeCloseTo(0, 2);
  });

  it('per-method rows: counted vs expected, difference signed', () => {
    const r = engine.buildCloseReport({
      ...base,
      counts: { cash: 130, mada: 5.75, visa: 5, mastercard: 0 },
    });
    const row = (m: string) => r.methods.find((x) => x.method === m)!;
    expect(row('cash').difference).toBeCloseTo(-8.75, 2);
    expect(row('mada').difference).toBeCloseTo(0, 2);
    expect(row('visa').difference).toBeCloseTo(-0.75, 2);
    expect(row('mastercard').expected).toBe(0);
    expect(row('mastercard').difference).toBe(0);
  });

  it('missing counts are treated as 0 (blank field = nothing counted)', () => {
    const r = engine.buildCloseReport({ ...base, counts: { cash: 100 } });
    const mada = r.methods.find((x) => x.method === 'mada')!;
    expect(mada.counted).toBe(0);
    expect(mada.difference).toBeCloseTo(-5.75, 2);
  });

  it('"other" row is expected-only and the rows add up to total sales', () => {
    const r = engine.buildCloseReport({ ...base, counts: { cash: 138.75 } });
    const other = r.methods.find((x) => x.method === 'other')!;
    expect(other.counted).toBeNull();
    expect(other.difference).toBeNull();
    // wallet 5.75 + split card share 18.75
    expect(other.sales).toBeCloseTo(24.5, 2);
    const total = r.methods.reduce((s, m) => s + m.sales, 0);
    expect(total).toBeCloseTo(r.totals.total_sales, 2);
  });

  it('carries the totals, cancelled figures and shift identity through', () => {
    const r = engine.buildCloseReport({ ...base, counts: { cash: 138.75 } });
    expect(r.totals.invoice_count).toBe(5);
    expect(r.totals.items_count).toBe(7);
    expect(r.totals.discount_total).toBe(1.5);
    expect(r.totals.tax_total).toBe(12.34);
    expect(r.totals.cancelled_count).toBe(1);
    expect(r.totals.cancelled_amount).toBe(5.75);
    expect(r.shift.cashier_name).toBe('Cashier');
    expect(r.revision).toBe(1);
    expect(r.legacy).toBe(false);
  });
});

describe('ShiftEngine - sales returns in the register (phase 3b)', () => {
  const engine = new ShiftEngine();
  const invoices = [
    { total: 28.75, payment_method: 'cash' },
    { total: 5.75, payment_method: 'mada' },
    { total: 5.75, payment_method: 'wallet' },
    { total: 28.75, payment_method: 'split', cash_amount: 10, card_amount: 18.75 },
  ];
  const returns = [
    { refund_method: 'cash', refund_cash: 10.35, refund_noncash: 0, refund_total: 10.35 },
    { refund_method: 'mada', refund_cash: 0, refund_noncash: 5.75, refund_total: 5.75 },
    { refund_method: 'split', refund_cash: 12, refund_noncash: 19.05, refund_total: 31.05 },
    { refund_method: 'wallet', refund_cash: 0, refund_noncash: 2, refund_total: 2 },
  ];

  const summary = engine.buildShiftSummary({
    openingCash: 100,
    closingCash: 0,
    invoices,
    expenses: [],
    returns,
  });

  it('cash refunds (incl. the cash share of a split refund) reduce expected cash', () => {
    // 100 + (28.75 + 10) - (10.35 + 12)
    expect(summary.totalReturnsCash).toBeCloseTo(22.35, 2);
    expect(summary.expectedCash).toBeCloseTo(116.4, 2);
  });

  it('non-cash refunds never touch the drawer and are counted per method', () => {
    expect(summary.totalReturnsNoncash).toBeCloseTo(26.8, 2);
    expect(summary.returnsByMethod.mada).toBeCloseTo(5.75, 2);
    expect(summary.returnsByMethod.split_card).toBeCloseTo(19.05, 2);
    expect(summary.returnsByMethod.wallet).toBeCloseTo(2, 2);
  });

  it('returned count and amount are reported; sales figures are unchanged', () => {
    expect(summary.returnedCount).toBe(4);
    expect(summary.returnedAmount).toBeCloseTo(49.15, 2);
    expect(summary.totalRevenue).toBeCloseTo(69, 2);
  });

  it('close report: per-method expected = sales - refunds, other row nets split card + wallet refunds', () => {
    const r = engine.buildCloseReport({
      summary,
      counts: { cash: 116.4, mada: 0, visa: 0, mastercard: 0 },
      shift: {
        id: 's', opened_at: 'a', closed_at: 'b', cashier_id: 'u',
        cashier_name: null, branch_id: 'b', branch_name: null, notes: null,
      },
      itemsCount: 0, discountTotal: 0, taxTotal: 0,
      cancelled: { count: 0, amount: 0 },
    });
    const row = (m: string) => r.methods.find((x) => x.method === m)!;
    expect(row('cash').returns).toBeCloseTo(22.35, 2);
    expect(row('cash').expected).toBeCloseTo(116.4, 2);
    expect(row('cash').difference).toBeCloseTo(0, 2);
    expect(row('mada').expected).toBeCloseTo(0, 2); // 5.75 sold - 5.75 refunded
    // other: wallet 5.75 + split card 18.75 = 24.50 sold; refunds 2 + 19.05
    expect(row('other').sales).toBeCloseTo(24.5, 2);
    expect(row('other').returns).toBeCloseTo(21.05, 2);
    expect(row('other').expected).toBeCloseTo(3.45, 2);
    expect(r.totals.returned_count).toBe(4);
    expect(r.totals.returned_amount).toBeCloseTo(49.15, 2);
  });

  it('no returns: behaves exactly as before', () => {
    const s = engine.buildShiftSummary({ openingCash: 0, closingCash: 0, invoices, expenses: [] });
    expect(s.totalReturnsCash).toBe(0);
    expect(s.returnedCount).toBe(0);
    expect(s.expectedCash).toBeCloseTo(38.75, 2);
  });
});
