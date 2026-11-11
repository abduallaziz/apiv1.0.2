// T10 / R3 (owner approved 2026-11-09): a split order is not its own payment
// method in the reports. It is decomposed into the money that really moved:
// the cash share (counted as cash) and the card share (counted as card).
//
// Older split orders predate migration 188 and have NULL cash_amount /
// card_amount; they cannot be decomposed, so their amount is reported as
// 'split_unallocated' instead of being hidden inside cash or card. The same
// bucket takes any difference when the stored shares do not add up to the
// order total.

export interface OrderPaymentInput {
  payment_method: string | null;
  total: number | null;
  cash_amount?: number | null;
  card_amount?: number | null;
}

export interface PaymentPart {
  method: string;
  amount: number;
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function paymentParts(o: OrderPaymentInput): PaymentPart[] {
  const total = Number(o.total ?? 0);
  if (o.payment_method !== 'split') {
    return [{ method: o.payment_method || 'unknown', amount: total }];
  }
  if (o.cash_amount == null || o.card_amount == null) {
    return [{ method: 'split_unallocated', amount: total }];
  }
  const cash = Number(o.cash_amount);
  const card = Number(o.card_amount);
  const parts: PaymentPart[] = [];
  if (cash > 0) parts.push({ method: 'cash', amount: cash });
  if (card > 0) parts.push({ method: 'card', amount: card });
  const diff = r2(total - (cash + card));
  if (Math.abs(diff) > 0.01) {
    parts.push({ method: 'split_unallocated', amount: diff });
  }
  return parts;
}

// { method: { count, total } } where count = orders that were (at least
// partly) paid with that method, and total = the money paid with it. The
// totals add up to the sum of the orders' totals.
export function aggregateByMethod(
  orders: OrderPaymentInput[],
): Record<string, { count: number; total: number }> {
  const out: Record<string, { count: number; total: number }> = {};
  for (const o of orders) {
    for (const p of paymentParts(o)) {
      if (!out[p.method]) out[p.method] = { count: 0, total: 0 };
      out[p.method].count += 1;
      out[p.method].total += p.amount;
    }
  }
  for (const m of Object.keys(out)) out[m].total = r2(out[m].total);
  return out;
}
