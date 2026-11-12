import { ZatcaAmounts, ZatcaDocInput } from './zatca.types';

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Turns the sale into the ZATCA amounts: NET line amounts (VAT is added on top, never inside
 * a line), the document discount as an allowance, VAT on the taxable amount, and the total.
 * Everything is derived from the lines so the XML is internally consistent by construction;
 * the caller compares `total` with what the customer actually paid (assertMatchesOrderTotal).
 */
export function computeZatcaAmounts(input: ZatcaDocInput): ZatcaAmounts {
  const category = input.tax_category ?? 'S';
  // Standard-rated needs a positive rate; zero-rated / exempt / out-of-scope are 0% with a reason.
  const rate = category === 'S' ? input.tax_rate : 0;
  if (category === 'S' && !(rate > 0)) {
    throw new Error('ZATCA_UNSUPPORTED: a standard-rated (S) sale needs VAT > 0');
  }
  if (category !== 'S' && !(input.exemption_reason_code && input.exemption_reason)) {
    throw new Error(`ZATCA_EXEMPTION_REASON_REQUIRED: category ${category} needs a VATEX reason code and text`);
  }
  const divisor = input.tax_inclusive ? 1 + rate : 1;

  const lines = input.lines.map((l) => {
    const net = r2(l.total / divisor);
    const tax = r2(net * rate);
    const qty = l.quantity;
    // price with enough decimals that quantity * price reproduces the line net
    const price = qty > 0 ? Math.round((net / qty) * 1e8) / 1e8 : 0;
    return { name: l.name, quantity: qty, price, net, tax, gross: r2(net + tax) };
  });

  const lines_net = r2(lines.reduce((s, l) => s + l.net, 0));
  const allowance = r2(input.discount / divisor);
  const taxable = r2(lines_net - allowance);
  const tax = r2(taxable * rate);
  const total = r2(taxable + tax);
  return {
    lines,
    lines_net,
    allowance,
    taxable,
    tax,
    total,
    rate_percent: Math.round(rate * 10000) / 100,
    category,
    exemption_reason_code: input.exemption_reason_code,
    exemption_reason: input.exemption_reason,
  };
}

/** Fail closed: the legal document must say what the customer really paid. */
export function assertMatchesOrderTotal(
  amounts: ZatcaAmounts,
  orderTotal: number,
  orderTax: number,
  tolerance = 0.05,
): void {
  if (
    Math.abs(amounts.total - orderTotal) > tolerance ||
    Math.abs(amounts.tax - orderTax) > tolerance
  ) {
    throw new Error(
      `ZATCA_AMOUNT_MISMATCH: computed total ${amounts.total} / tax ${amounts.tax} differ from the order (${orderTotal} / ${orderTax})`,
    );
  }
}
