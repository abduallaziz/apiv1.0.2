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
  /** Invoice: tenants.printer_settings.auto_print. Kitchen: printer_settings.kitchen_auto_print.
   *  Print right after a sale without asking. */
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
