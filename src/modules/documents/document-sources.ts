import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { DocumentType } from './document.types';

// Document Template Builder, Phase 10: where a document's DATA comes from. Templates never
// compute or alter money (design A8): every figure below is either read verbatim from an existing
// record (orders) or computed here, server-side, from line inputs. Nothing in this file writes to
// orders / invoices / accounting / ZATCA tables.

export type Lang = 'ar' | 'en';

export interface ResolvedDocument {
  /** Whitelisted sections (see bindings.catalog) + the `items` / `totals` lists. */
  data: Record<string, unknown>;
  /** Figures for the ZATCA QR (TLV), computed/read by the backend. */
  money: { total: number; vat: number };
  /** An already-issued ZATCA Phase 2 QR for this sale, when one exists (reused as-is). */
  zatcaQr?: string | null;
  sourceRef: string;
  documentNumber: string;
  documentDate: string;
}

export interface ManualItemInput {
  name: string;
  quantity: number;
  unit_price: number;
  discount?: number;
  sku?: string;
  unit?: string;
}

export interface ManualInput {
  customer?: Record<string, unknown>;
  document?: Record<string, unknown>;
  payment?: Record<string, unknown>;
  items: ManualItemInput[];
}

export const ORDER_DOC_TYPES: DocumentType[] = [
  'tax_invoice',
  'simplified_invoice',
  'receipt',
];

const PREFIX: Record<string, string> = {
  quotation: 'QT',
  payment_voucher: 'PV',
  work_order: 'WO',
  delivery_note: 'DN',
  purchase_order: 'PO',
  customer_statement: 'ST',
  custom: 'DOC',
};

const LABELS: Record<Lang, Record<string, string>> = {
  en: {
    subtotal: 'Subtotal',
    discount: 'Discount',
    vat: 'VAT',
    total: 'Total',
  },
  ar: {
    subtotal: 'المجموع الفرعي',
    discount: 'الخصم',
    vat: 'ضريبة القيمة المضافة',
    total: 'الإجمالي',
  },
};

/** Money in halalas as integers: no floating-point drift in totals. */
const cents = (n: number) => Math.round(n * 100);
const fromCents = (c: number) => c / 100;
const asStr = (v: unknown, max = 200): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;

function pick(obj: Record<string, unknown> | undefined, keys: string[]) {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const v = asStr(obj?.[k]);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * Totals for staff-entered lines. `rate` is the tenant's tax fraction (0.15 = 15%).
 * Exclusive pricing adds VAT on top; inclusive pricing extracts it from the lines.
 */
export function computeManualTotals(
  items: ManualItemInput[],
  rate: number,
  inclusive: boolean,
  lang: Lang,
) {
  if (items.length === 0)
    throw new BadRequestException('At least one item is required');
  let lineSum = 0;
  let discountSum = 0;
  const rows = items.map((it) => {
    const qty = it.quantity;
    const price = cents(it.unit_price);
    const gross = Math.round(qty * price);
    const disc = cents(it.discount ?? 0);
    if (!(qty > 0) || price < 0 || disc < 0 || disc > gross) {
      throw new BadRequestException(`Invalid line "${it.name}"`);
    }
    const net = gross - disc;
    lineSum += net;
    discountSum += disc;
    return { it, net, disc };
  });

  const vatCents = inclusive
    ? Math.round(lineSum - lineSum / (1 + rate))
    : Math.round(lineSum * rate);
  const subtotalCents = inclusive ? lineSum - vatCents : lineSum;
  const totalCents = inclusive ? lineSum : lineSum + vatCents;
  const L = LABELS[lang];

  const items2 = rows.map(({ it, net }) => ({
    name: it.name,
    sku: it.sku,
    unit: it.unit,
    quantity: it.quantity,
    unit_price: it.unit_price,
    discount: it.discount ?? 0,
    tax: fromCents(
      inclusive ? Math.round(net - net / (1 + rate)) : Math.round(net * rate),
    ),
    total: fromCents(net),
  }));
  const totals: Array<{ label: string; value: number; strong?: boolean }> = [
    { label: L.subtotal, value: fromCents(subtotalCents) },
  ];
  if (discountSum > 0)
    totals.push({ label: L.discount, value: fromCents(discountSum) });
  if (rate > 0) {
    totals.push({
      label: `${L.vat} ${+(rate * 100).toFixed(2)}%`,
      value: fromCents(vatCents),
    });
  }
  totals.push({ label: L.total, value: fromCents(totalCents), strong: true });
  return {
    items: items2,
    totals,
    total: fromCents(totalCents),
    vat: fromCents(vatCents),
  };
}

interface TenantRow {
  name: string;
  tax_number: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  tax_rate: string | number | null;
  tax_inclusive_pricing: boolean | null;
}

async function loadTenant(
  client: PoolClient,
  tenantId: string,
): Promise<TenantRow> {
  const r = await client.query<TenantRow>(
    `SELECT name, tax_number, phone, email, address, tax_rate, tax_inclusive_pricing
       FROM tenants WHERE id = $1`,
    [tenantId],
  );
  if (r.rows.length === 0) throw new NotFoundException('Tenant not found');
  return r.rows[0];
}

const companyOf = (t: TenantRow) => ({
  name: t.name,
  vat_number: t.tax_number ?? undefined,
  phone: t.phone ?? undefined,
  email: t.email ?? undefined,
  address: t.address ?? undefined,
});

async function loadBranch(
  client: PoolClient,
  tenantId: string,
  branchId: string | null,
) {
  if (!branchId) return undefined;
  const r = await client.query<{ name: string; address: string | null }>(
    `SELECT name, address FROM branches WHERE id = $1 AND tenant_id = $2`,
    [branchId, tenantId],
  );
  const b = r.rows[0];
  return b ? { name: b.name, address: b.address ?? undefined } : undefined;
}

/** Staff-entered documents (quotation, voucher, delivery note ...). Money is computed here. */
export async function resolveManual(
  client: PoolClient,
  tenantId: string,
  branchId: string | null,
  docType: DocumentType,
  sourceId: string,
  input: ManualInput | undefined,
  lang: Lang,
  now: Date,
): Promise<ResolvedDocument> {
  if (!input)
    throw new BadRequestException('input is required for this document type');
  const tenant = await loadTenant(client, tenantId);
  const rate = Number(tenant.tax_rate ?? 0);
  const calc = computeManualTotals(
    input.items,
    rate,
    tenant.tax_inclusive_pricing === true,
    lang,
  );
  const date = now.toISOString().slice(0, 10);
  const number =
    asStr(input.document?.number, 40) ??
    `${PREFIX[docType] ?? 'DOC'}-${now.getTime().toString(36).toUpperCase()}`;
  const data = {
    company: companyOf(tenant),
    branch: await loadBranch(client, tenantId, branchId),
    customer: pick(input.customer, [
      'name',
      'phone',
      'email',
      'vat_number',
      'address',
    ]),
    document: {
      ...pick(input.document, [
        'valid_until',
        'due_date',
        'reference',
        'notes',
      ]),
      number,
      date: asStr(input.document?.date, 10) ?? date,
    },
    payment: pick(input.payment, ['method', 'bank_name', 'iban']),
    items: calc.items,
    totals: calc.totals,
  };
  return {
    data,
    money: { total: calc.total, vat: calc.vat },
    sourceRef: `manual:${sourceId}`,
    documentNumber: number,
    documentDate: data.document.date,
  };
}

/** Invoices / receipts of a sale: read-only; every figure is the stored one, verbatim. */
export async function resolveOrder(
  client: PoolClient,
  tenantId: string,
  orderId: string,
  lang: Lang,
): Promise<ResolvedDocument> {
  const o = await client.query<{
    id: string;
    invoice_no: string | null;
    created_at: Date;
    subtotal: string;
    discount: string;
    tax: string;
    total: string;
    payment_method: string | null;
    branch_id: string | null;
    customer_id: string | null;
    notes: string | null;
    status: string;
  }>(
    `SELECT id, invoice_no, created_at, subtotal, discount, tax, total, payment_method,
            branch_id, customer_id, notes, status
       FROM orders WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
    [orderId, tenantId],
  );
  if (o.rows.length === 0) throw new NotFoundException('Sale not found');
  const order = o.rows[0];
  if (order.status === 'cancelled')
    throw new BadRequestException(
      'Cannot issue a document for a cancelled sale',
    );

  const [tenant, items, cust, zatca, branch] = await Promise.all([
    loadTenant(client, tenantId),
    client.query<{
      item_name: string;
      qty: number;
      price: string;
      total_price: string;
    }>(
      `SELECT item_name, qty, price, total_price FROM order_items
        WHERE order_id = $1 AND deleted_at IS NULL ORDER BY created_at, id`,
      [orderId],
    ),
    order.customer_id
      ? client.query<Record<string, string | null>>(
          `SELECT full_name, phone, email, vat_number FROM customers
            WHERE id = $1 AND tenant_id = $2`,
          [order.customer_id, tenantId],
        )
      : Promise.resolve({ rows: [] as Array<Record<string, string | null>> }),
    client.query<{ qr: string }>(
      `SELECT qr FROM zatca_invoices
        WHERE order_id = $1 AND tenant_id = $2 AND kind = 'invoice' AND deleted_at IS NULL
        ORDER BY created_at DESC LIMIT 1`,
      [orderId, tenantId],
    ),
    loadBranch(client, tenantId, order.branch_id),
  ]);

  const L = LABELS[lang];
  const num = (v: string) => Number(v);
  const totals: Array<{ label: string; value: number; strong?: boolean }> = [
    { label: L.subtotal, value: num(order.subtotal) },
  ];
  if (num(order.discount) > 0)
    totals.push({ label: L.discount, value: num(order.discount) });
  if (num(order.tax) > 0) totals.push({ label: L.vat, value: num(order.tax) });
  totals.push({ label: L.total, value: num(order.total), strong: true });

  const number =
    order.invoice_no ?? order.id.replace(/-/g, '').slice(-6).toUpperCase();
  const c = cust.rows[0];
  const data = {
    company: companyOf(tenant),
    branch,
    customer: c
      ? {
          name: c.full_name ?? undefined,
          phone: c.phone ?? undefined,
          email: c.email ?? undefined,
          vat_number: c.vat_number ?? undefined,
        }
      : {},
    document: {
      number,
      date: new Date(order.created_at).toISOString().slice(0, 10),
      notes: order.notes ?? undefined,
    },
    payment: { method: order.payment_method ?? undefined },
    items: items.rows.map((i) => ({
      name: i.item_name,
      quantity: i.qty,
      unit_price: num(i.price),
      total: num(i.total_price),
    })),
    totals,
  };
  return {
    data,
    money: { total: num(order.total), vat: num(order.tax) },
    zatcaQr: zatca.rows[0]?.qr ?? null,
    sourceRef: `order:${orderId}`,
    documentNumber: number,
    documentDate: data.document.date,
  };
}
