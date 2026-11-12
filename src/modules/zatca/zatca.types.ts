// ZATCA e-invoicing phase 2 (Fatoora) — shared types.
// Everything in src/modules/zatca works WITHOUT a connection to ZATCA: it prepares, hashes, signs and
// stores the documents. Sending them is the only part that waits for the connection (ZatcaGateway).

export type ZatcaDocKind = 'invoice' | 'credit_note' | 'debit_note';
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
  buyer_name?: string | null;
  /** Credit/debit notes: the invoice they correct and why. */
  reference_invoice_no?: string;
  reason?: string;
  seller: ZatcaSeller;
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
