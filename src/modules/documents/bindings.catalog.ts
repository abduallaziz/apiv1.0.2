// Document Template Builder, Phase 7: the ONLY data a template may bind to (design A4/§8).
// A binding is `{{group.field}}` inside a text element, or a column key of the items table.
// Anything not listed here is rejected when a template is saved and resolves to nothing when
// rendered, so a template can never reach data the backend did not explicitly expose.
// Financial figures (items/totals) are computed by the backend and only DISPLAYED here.

export interface BindingDef {
  path: string;
  group: 'company' | 'branch' | 'customer' | 'document' | 'payment';
  label: { en: string; ar: string };
}

export const BINDINGS: BindingDef[] = [
  {
    path: 'company.name',
    group: 'company',
    label: { en: 'Company name', ar: 'اسم الشركة' },
  },
  {
    path: 'company.vat_number',
    group: 'company',
    label: { en: 'VAT number', ar: 'الرقم الضريبي' },
  },
  {
    path: 'company.cr_number',
    group: 'company',
    label: { en: 'Commercial registration', ar: 'السجل التجاري' },
  },
  {
    path: 'company.phone',
    group: 'company',
    label: { en: 'Phone', ar: 'الهاتف' },
  },
  {
    path: 'company.email',
    group: 'company',
    label: { en: 'Email', ar: 'البريد الإلكتروني' },
  },
  {
    path: 'company.address',
    group: 'company',
    label: { en: 'Address', ar: 'العنوان' },
  },

  {
    path: 'branch.name',
    group: 'branch',
    label: { en: 'Branch name', ar: 'اسم الفرع' },
  },
  {
    path: 'branch.phone',
    group: 'branch',
    label: { en: 'Branch phone', ar: 'هاتف الفرع' },
  },
  {
    path: 'branch.address',
    group: 'branch',
    label: { en: 'Branch address', ar: 'عنوان الفرع' },
  },

  {
    path: 'customer.name',
    group: 'customer',
    label: { en: 'Customer name', ar: 'اسم العميل' },
  },
  {
    path: 'customer.phone',
    group: 'customer',
    label: { en: 'Customer phone', ar: 'هاتف العميل' },
  },
  {
    path: 'customer.email',
    group: 'customer',
    label: { en: 'Customer email', ar: 'بريد العميل' },
  },
  {
    path: 'customer.vat_number',
    group: 'customer',
    label: { en: 'Customer VAT number', ar: 'الرقم الضريبي للعميل' },
  },
  {
    path: 'customer.address',
    group: 'customer',
    label: { en: 'Customer address', ar: 'عنوان العميل' },
  },

  {
    path: 'document.number',
    group: 'document',
    label: { en: 'Document number', ar: 'رقم المستند' },
  },
  {
    path: 'document.date',
    group: 'document',
    label: { en: 'Date', ar: 'التاريخ' },
  },
  {
    path: 'document.valid_until',
    group: 'document',
    label: { en: 'Valid until', ar: 'صالح حتى' },
  },
  {
    path: 'document.due_date',
    group: 'document',
    label: { en: 'Due date', ar: 'تاريخ الاستحقاق' },
  },
  {
    path: 'document.reference',
    group: 'document',
    label: { en: 'Reference', ar: 'المرجع' },
  },
  {
    path: 'document.notes',
    group: 'document',
    label: { en: 'Notes', ar: 'ملاحظات' },
  },

  {
    path: 'payment.method',
    group: 'payment',
    label: { en: 'Payment method', ar: 'طريقة الدفع' },
  },
  {
    path: 'payment.bank_name',
    group: 'payment',
    label: { en: 'Bank name', ar: 'اسم البنك' },
  },
  {
    path: 'payment.iban',
    group: 'payment',
    label: { en: 'IBAN', ar: 'الآيبان' },
  },
];

export const BINDING_PATHS = new Set(BINDINGS.map((b) => b.path));

/** Columns an items table may show (data comes from the backend-computed `items` list). */
export const ITEM_COLUMNS: Array<{
  key: string;
  label: { en: string; ar: string };
}> = [
  { key: 'index', label: { en: '#', ar: 'م' } },
  { key: 'name', label: { en: 'Item', ar: 'الصنف' } },
  { key: 'description', label: { en: 'Description', ar: 'الوصف' } },
  { key: 'sku', label: { en: 'SKU', ar: 'الرمز' } },
  { key: 'unit', label: { en: 'Unit', ar: 'الوحدة' } },
  { key: 'quantity', label: { en: 'Qty', ar: 'الكمية' } },
  { key: 'unit_price', label: { en: 'Price', ar: 'السعر' } },
  { key: 'discount', label: { en: 'Discount', ar: 'الخصم' } },
  { key: 'tax', label: { en: 'Tax', ar: 'الضريبة' } },
  { key: 'total', label: { en: 'Total', ar: 'الإجمالي' } },
];
export const ITEM_COLUMN_KEYS = new Set(ITEM_COLUMNS.map((c) => c.key));

/** Sections shown by the structured blocks (company_info etc.), in display order. */
export function sectionFields(section: string): BindingDef[] {
  return BINDINGS.filter((b) => b.group === section);
}

/** Field keys a structured block may show (company: name, phone ...). */
export function sectionFieldKeys(section: string): Set<string> {
  return new Set(sectionFields(section).map((b) => b.path.split('.')[1]));
}

const BINDING_RE = /\{\{\s*([^{}]*?)\s*\}\}/g;

/** Paths used by `{{...}}` placeholders in a text (including unknown ones). */
export function bindingsInText(text: string): string[] {
  return [...text.matchAll(BINDING_RE)].map((m) => m[1]);
}

/**
 * Keeps only whitelisted leaves of a resolved-data object (plus the backend-computed `items` and
 * `totals` lists, trimmed to known keys). Used before rendering so unlisted data never reaches HTML.
 */
export function filterResolvedData(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const b of BINDINGS) {
    const [group, field] = b.path.split('.');
    const src = (data as Record<string, Record<string, unknown> | undefined>)[
      group
    ];
    if (src && Object.prototype.hasOwnProperty.call(src, field)) {
      const bucket = (out[group] ??= {}) as Record<string, unknown>;
      bucket[field] = src[field];
    }
  }
  if (Array.isArray(data.items)) {
    out.items = (data.items as Array<Record<string, unknown>>).map((row) => {
      const r: Record<string, unknown> = {};
      for (const k of ITEM_COLUMN_KEYS)
        if (Object.prototype.hasOwnProperty.call(row, k)) r[k] = row[k];
      return r;
    });
  }
  if (Array.isArray(data.totals)) {
    out.totals = (data.totals as Array<Record<string, unknown>>).map((t) => ({
      label: t.label,
      value: t.value,
      strong: t.strong,
    }));
  }
  return out;
}
