// Print templates + payloads (T13 / printing tasks T1-T3).
// A template stores ONLY presentation choices. Business facts (name, address,
// phone, tax number, footer, logo) fall back to the existing tenant columns when
// a template field is null/absent, so an empty template '{}' = today's look.

export type TemplateKind = 'invoice' | 'kitchen';
export type PaperWidth = '58mm' | '80mm' | 'A4';

export const PAPER_WIDTHS: PaperWidth[] = ['58mm', '80mm', 'A4'];
export const INVOICE_BLOCK_KEYS = [
  'customer',
  'vehicle',
  'cashier',
  'worker',
  'payments',
  'notes',
] as const;
export const KITCHEN_BLOCK_KEYS = [
  'order_number',
  'table',
  'vehicle',
  'time',
  'cashier',
  'notes',
] as const;
export const KITCHEN_FONT_SIZES = ['sm', 'md', 'lg'] as const;

export interface TemplateBlock {
  key: string;
  visible: boolean;
}

// ---- Designer v2 (docs/DESIGN_INVOICE_DESIGNER_V2.md, phase 1) ----------------
// Presentation choices only. Every field has a default that reproduces the
// receipt exactly as it looked before, so a template saved earlier (or '{}')
// still prints the same. Legally required ZATCA elements (seller name, tax
// number, date/time, invoice number, VAT amount, total, QR) are NOT toggles:
// they can be renamed (labels) but never hidden.
export const STYLE_FONT_SIZES = ['sm', 'md', 'lg'] as const;
export const STYLE_FONT_WEIGHTS = ['normal', 'bold_totals'] as const;
export const STYLE_ALIGNS = ['start', 'center'] as const;
export const STYLE_LINE_SPACINGS = ['compact', 'normal', 'relaxed'] as const;
export const STYLE_SEPARATORS = ['dashed', 'solid', 'none'] as const;
export const STYLE_HEADER_LAYOUTS = ['logo_top', 'logo_side', 'text_only'] as const;
/** Named accents only (never a free colour string). */
export const STYLE_ACCENTS = ['black', 'blue', 'green', 'red', 'purple', 'gray'] as const;
export const RECEIPT_LANGUAGES = ['auto', 'ar', 'en', 'bilingual'] as const;
export const DATE_FORMATS = ['mdy', 'dmy', 'ymd'] as const;
export const TIME_FORMATS = ['12h', '24h'] as const;
/** Label keys the owner may rename (value: plain text, max 40 chars). */
export const LABEL_KEYS = [
  'title',
  'invoice',
  'date',
  'customer',
  'vehicle',
  'cashier',
  'worker',
  'subtotal',
  'discount',
  'vat',
  'total',
  'payments',
  'cashTendered',
  'change',
  'notes',
  'taxNumber',
  'commercialRegister',
] as const;

export interface InvoiceStyle {
  font_size: (typeof STYLE_FONT_SIZES)[number];
  font_weight: (typeof STYLE_FONT_WEIGHTS)[number];
  /** Alignment of the header and footer text. */
  align: (typeof STYLE_ALIGNS)[number];
  line_spacing: (typeof STYLE_LINE_SPACINGS)[number];
  separators: (typeof STYLE_SEPARATORS)[number];
  accent: (typeof STYLE_ACCENTS)[number];
  header_layout: (typeof STYLE_HEADER_LAYOUTS)[number];
}

export interface InvoiceTemplate {
  /** Storage path of an uploaded logo (private bucket); resolved to a signed URL in the payload. */
  logo_path: string | null;
  /** External logo URL (falls back to tenants.logo_url). */
  logo_url: string | null;
  show_logo: boolean;
  business_name: string | null;
  address: string | null;
  phone: string | null;
  /** OPTIONAL: shown only when filled. Falls back to tenants.tax_number. */
  tax_number: string | null;
  commercial_register: string | null;
  footer: string | null;
  paper_width: PaperWidth;
  blocks: TemplateBlock[];
  /** ZATCA QR; only rendered when true AND a tax number exists. */
  qr_enabled: boolean;
  copies: number;
  // ---- Designer v2 ----
  style: InvoiceStyle;
  language: (typeof RECEIPT_LANGUAGES)[number];
  /** Item name and line total are always shown. */
  item_columns: { variant: boolean; qty: boolean; unit_price: boolean };
  /** VAT and total are always shown. */
  totals_lines: { subtotal: boolean; discount: boolean };
  /** Renamed headings, only for keys in LABEL_KEYS. */
  labels: Record<string, string>;
  /** Invoice title, e.g. "Simplified Tax Invoice". */
  title: string | null;
  header_text: string | null;
  terms_text: string | null;
  custom_fields: { label: string; value: string }[];
  date_format: (typeof DATE_FORMATS)[number];
  time_format: (typeof TIME_FORMATS)[number];
  /** Sequential invoice number format (used by the numbering phase). */
  invoice_number: { prefix: string; padding: number };
}

export interface KitchenTemplate {
  header_text: string | null;
  paper_width: PaperWidth;
  font_size: (typeof KITCHEN_FONT_SIZES)[number];
  blocks: TemplateBlock[];
  show_item_notes: boolean;
  copies: number;
}

export type AnyTemplate = InvoiceTemplate | KitchenTemplate;

export interface PrintPayloadBase {
  kind: TemplateKind;
  order_id: string;
  /** Short number shown to people: last 6 chars of the order id, upper-case. */
  order_number: string;
  created_at: string;
  currency_symbol: string;
  /** tenants.printer_settings.auto_print: print right after a sale without asking. */
  auto_print: boolean;
}

export interface InvoicePrintPayload extends PrintPayloadBase {
  kind: 'invoice';
  template: InvoiceTemplate;
  business: {
    name: string;
    address: string | null;
    phone: string | null;
    tax_number: string | null;
    commercial_register: string | null;
    logo_url: string | null;
    footer: string | null;
  };
  status: string;
  items: {
    name: string;
    variant_name: string | null;
    quantity: number;
    unit_price: number;
    total: number;
  }[];
  totals: {
    subtotal: number;
    discount: number;
    tax: number;
    total: number;
    tax_rate: number;
    tax_inclusive: boolean;
  };
  payments: { method: string; amount: number }[];
  /** cash_tendered/change only when the caller supplied `tendered` (not persisted on orders). */
  cash_tendered: number | null;
  change: number | null;
  cashier_name: string | null;
  customer: { name: string | null; phone: string | null } | null;
  vehicle_plate: string | null;
  /** Reserved for the wash-queue feature (not stored on orders yet). */
  worker_name: string | null;
  note: string | null;
  qr_base64: string | null;
}

export interface KitchenPrintPayload extends PrintPayloadBase {
  kind: 'kitchen';
  template: KitchenTemplate;
  header_text: string | null;
  business_name: string;
  table_name: string | null;
  vehicle_plate: string | null;
  cashier_name: string | null;
  /** NO prices. */
  items: {
    name: string;
    variant_name: string | null;
    quantity: number;
    kitchen_status: string | null;
  }[];
  note: string | null;
  /** True when only items not yet served are included. */
  only_unsent: boolean;
}
