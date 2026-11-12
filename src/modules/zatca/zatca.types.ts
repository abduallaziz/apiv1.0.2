// ZATCA e-invoicing phase 2 (Fatoora) — shared types.
// Everything in src/modules/zatca works WITHOUT a connection to ZATCA: it prepares, hashes, signs and
// stores the documents. Sending them is the only part that waits for the connection (ZatcaGateway).

export type ZatcaDocKind = 'invoice' | 'credit_note' | 'debit_note';
/** ZATCA VAT category: Standard-rated, Zero-rated, Exempt, Out-of-scope. */
export type ZatcaTaxCategory = 'S' | 'Z' | 'E' | 'O';
export type ZatcaEnv = 'sandbox' | 'simulation' | 'production';

/** Seller (taxpayer) data kept on the device row; the structured national address is mandatory. */
export interface ZatcaSeller {
  legal_name: string;
  /** 15 digits, starts and ends with 3. */
  vat_number: string;
  /** Seller identification number (mandatory): commercial registration number by default. */
  crn: string;
  /** Scheme of `crn`: CRN, MOM, MLS, 700, SAG or OTH. Defaults to CRN. */
  id_scheme?: 'CRN' | 'MOM' | 'MLS' | '700' | 'SAG' | 'OTH';
  street: string;
  /** 4 digits. */
  building_no: string;
  plot_id?: string;
  district: string;
  city: string;
  /** 5 digits. */
  postal_zone: string;
}

export interface ZatcaLine {
  name: string;
  quantity: number;
  /** Unit price as sold: includes VAT when the tenant prices tax-inclusive. */
  unit_price: number;
  /** quantity * unit_price as stored on the order line. */
  total: number;
}

/**
 * The buyer. A `vat_number` makes the document a STANDARD tax invoice (B2B, 0100000) — then the
 * national address is mandatory. With no `vat_number` the document is SIMPLIFIED (B2C, 0200000) and
 * only an optional display name is used.
 */
export interface ZatcaBuyer {
  name?: string | null;
  /** 15 digits, starts and ends with 3. Presence switches the document to standard. */
  vat_number?: string;
  /** Buyer identification (CRN by default); optional on standard invoices. */
  crn?: string;
  id_scheme?: 'CRN' | 'MOM' | 'MLS' | '700' | 'SAG' | 'OTH' | 'NAT' | 'TIN' | 'IQA' | 'PAS' | 'GCC';
  street?: string;
  building_no?: string;
  plot_id?: string;
  district?: string;
  city?: string;
  postal_zone?: string;
}

export interface ZatcaDocInput {
  kind: ZatcaDocKind;
  /** The sequential legal number (INV-000123). */
  invoice_no: string;
  uuid: string;
  icv: number;
  /** Hash of the previous document of the same device (base64). */
  pih: string;
  issue_at: Date;
  currency: string;
  /** VAT as a fraction (0.15). */
  tax_rate: number;
  tax_inclusive: boolean;
  lines: ZatcaLine[];
  /** Document-level discount, on the same basis as the lines (gross when tax-inclusive). */
  discount: number;
  /** UN/CEFACT payment means: 10 cash, 30 credit, 42 bank account, 48 card. */
  payment_code: '10' | '30' | '42' | '48';
  /**
   * VAT category for the whole document (Sefay prices at one rate): S standard-rated (needs a
   * positive rate), Z zero-rated, E exempt, O out of scope. Defaults to S. Z/E/O carry a 0% rate and
   * a VATEX exemption reason.
   */
  tax_category?: ZatcaTaxCategory;
  /** VATEX reason code (e.g. VATEX-SA-32) — required for Z, E and O. */
  exemption_reason_code?: string;
  /** Human-readable exemption reason — required for Z, E and O. */
  exemption_reason?: string;
  buyer?: ZatcaBuyer | null;
  /** Credit/debit notes: the invoice they correct and why. */
  reference_invoice_no?: string;
  reason?: string;
  seller: ZatcaSeller;
}

/** True when the buyer carries a VAT number: the document must be a standard (B2B) tax invoice. */
export function isStandardInvoice(input: Pick<ZatcaDocInput, 'buyer'>): boolean {
  return !!input.buyer?.vat_number;
}

/** Amounts exactly as they go into the XML (2 decimals, all derived from the lines). */
export interface ZatcaAmounts {
  lines: {
    name: string;
    quantity: number;
    /** Net price per unit (up to 8 decimals so qty * price = net). */
    price: number;
    net: number;
    tax: number;
    gross: number;
  }[];
  lines_net: number;
  allowance: number;
  taxable: number;
  tax: number;
  total: number;
  rate_percent: number;
  category: ZatcaTaxCategory;
  exemption_reason_code?: string;
  exemption_reason?: string;
}

export interface ZatcaDeviceCredentials {
  privateKeyPem: string;
  /** PEM of the CSID certificate issued by ZATCA (compliance or production). */
  certificatePem: string;
}

export interface ZatcaGeneratedDoc {
  uuid: string;
  icv: number;
  pih: string;
  /** base64 SHA-256 of the canonical unsigned invoice; becomes the next PIH. */
  invoice_hash: string;
  /** base64 ECDSA signature of the invoice hash. */
  signature: string;
  qr: string;
  /** Final signed XML (what is sent to ZATCA). */
  xml: string;
}
