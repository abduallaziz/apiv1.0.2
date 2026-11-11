import { aggregateByMethod, paymentParts } from './payment-parts';

describe('paymentParts (split decomposition)', () => {
  it('a non-split order is one part with its own method and total', () => {
    expect(paymentParts({ payment_method: 'mada', total: 11.5 })).toEqual([
      { method: 'mada', amount: 11.5 },
    ]);
    expect(paymentParts({ payment_method: null, total: 3 })).toEqual([
      { method: 'unknown', amount: 3 },
    ]);
  });

  it('a split order becomes its cash share and its card share', () => {
    expect(
      paymentParts({ payment_method: 'split', total: 28.75, cash_amount: 10, card_amount: 18.75 }),
    ).toEqual([
      { method: 'cash', amount: 10 },
      { method: 'card', amount: 18.75 },
    ]);
  });

  it('a legacy split order without shares is reported as unallocated, never hidden in cash or card', () => {
    expect(paymentParts({ payment_method: 'split', total: 100 })).toEqual([
      { method: 'split_unallocated', amount: 100 },
    ]);
  });

  it('shares that do not add up to the total leave the difference unallocated', () => {
    expect(
      paymentParts({ payment_method: 'split', total: 50, cash_amount: 20, card_amount: 25 }),
    ).toEqual([
      { method: 'cash', amount: 20 },
      { method: 'card', amount: 25 },
      { method: 'split_unallocated', amount: 5 },
    ]);
  });
});

describe('aggregateByMethod', () => {
  const orders = [
    { payment_method: 'cash', total: 28.75 },
    { payment_method: 'mada', total: 5.75 },
    { payment_method: 'split', total: 28.75, cash_amount: 10, card_amount: 18.75 },
    { payment_method: 'split', total: 100 },
  ];
  const r = aggregateByMethod(orders);

  it('cash includes the cash share of splits, card their card share', () => {
    expect(r.cash).toEqual({ count: 2, total: 38.75 });
    expect(r.card).toEqual({ count: 1, total: 18.75 });
    expect(r.split_unallocated).toEqual({ count: 1, total: 100 });
  });

  it('the method totals add up to the sum of the order totals', () => {
    const sum = Object.values(r).reduce((s, v) => s + v.total, 0);
    expect(sum).toBeCloseTo(163.25, 2);
  });
});
