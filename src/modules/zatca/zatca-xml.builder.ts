import { ZatcaAmounts, ZatcaBuyer, ZatcaDocInput, isStandardInvoice } from './zatca.types';

// UBL 2.1 invoice for ZATCA (simplified tax invoice, credit note, debit note), written DIRECTLY in
// canonical XML form: namespace declarations in canonical order, attributes sorted, no XML
// declaration, no whitespace between elements, empty elements as start+end tags, canonical
// escaping. Because the bytes we emit ARE the canonical bytes, the hash we compute is the hash a
// verifier gets after removing the signature parts and canonicalizing (C14N 1.1).
// The signature parts (ext:UBLExtensions, the QR reference and cac:Signature) are inserted at
// fixed positions and are excluded from the hash, as the specification requires.

const NS_INVOICE = 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2';
const NS_CAC = 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2';
const NS_CBC = 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2';
const NS_EXT = 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2';

export const SIGNATURE_ID = 'urn:oasis:names:specification:ubl:signature:Invoice';
export const SIGNATURE_METHOD = 'urn:oasis:names:specification:ubl:dsig:enveloped:xades';

const TYPE_CODE = { invoice: '388', credit_note: '381', debit_note: '383' } as const;

export function escText(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r/g, '&#xD;');
}
export function escAttr(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;')
    .replace(/\t/g, '&#x9;')
    .replace(/\n/g, '&#xA;')
    .replace(/\r/g, '&#xD;');
}

const m2 = (n: number) => n.toFixed(2);
/** price: at least 2 decimals, up to 8 (quantity * price must reproduce the line net). */
const price = (n: number) => {
  const s = n.toFixed(8).replace(/0+$/, '');
  const [i, d = ''] = s.split('.');
  return `${i}.${d.padEnd(2, '0')}`;
};
const qty = (n: number) => n.toFixed(6);

/** KSA local date/time (UTC+3, no daylight saving) as the document's IssueDate / IssueTime. */
export function ksaDateTime(d: Date): { date: string; time: string } {
  const local = new Date(d.getTime() + 3 * 3600 * 1000).toISOString();
  return { date: local.slice(0, 10), time: local.slice(11, 19) };
}

const el = (name: string, content: string, attrs = '') => `<${name}${attrs}>${content}</${name}>`;
const cbc = (name: string, value: string, attrs = '') => el(`cbc:${name}`, escText(value), attrs);
const cur = (c: string) => ` currencyID="${escAttr(c)}"`;

function party(inner: string) {
  return el('cac:Party', inner);
}

/**
 * AccountingCustomerParty. The UBL schema makes this element MANDATORY (ZATCA sandbox XSD rejects
 * the document without it), so it is always emitted. Standard (B2B) invoices carry the full buyer
 * identity (tax scheme + national address, both mandatory); simplified invoices carry a legal-entity
 * name when one is given, and an empty Party for a nameless walk-in buyer.
 */
function buildCustomerParty(buyer: ZatcaBuyer | null | undefined, standard: boolean): string {
  if (standard) {
    if (!buyer?.vat_number) throw new Error('ZATCA_BUYER_INCOMPLETE: a standard (B2B) invoice needs the buyer VAT number');
    const missing = (['street', 'building_no', 'district', 'city', 'postal_zone'] as const).filter((k) => !buyer[k]);
    if (missing.length) {
      throw new Error(`ZATCA_BUYER_INCOMPLETE: a standard (B2B) invoice needs the buyer's ${missing.join(', ')}`);
    }
    const inner =
      (buyer.crn ? el('cac:PartyIdentification', cbc('ID', buyer.crn, ` schemeID="${escAttr(buyer.id_scheme ?? 'CRN')}"`)) : '') +
      el(
        'cac:PostalAddress',
        cbc('StreetName', buyer.street!) +
          cbc('BuildingNumber', buyer.building_no!) +
          (buyer.plot_id ? cbc('PlotIdentification', buyer.plot_id) : '') +
          cbc('CitySubdivisionName', buyer.district!) +
          cbc('CityName', buyer.city!) +
          cbc('PostalZone', buyer.postal_zone!) +
          el('cac:Country', cbc('IdentificationCode', 'SA')),
      ) +
      el('cac:PartyTaxScheme', cbc('CompanyID', buyer.vat_number) + el('cac:TaxScheme', cbc('ID', 'VAT'))) +
      el('cac:PartyLegalEntity', cbc('RegistrationName', buyer.name ?? buyer.vat_number));
    return el('cac:AccountingCustomerParty', party(inner));
  }
  const inner = buyer?.name ? el('cac:PartyLegalEntity', cbc('RegistrationName', buyer.name)) : '';
  return el('cac:AccountingCustomerParty', party(inner));
}

/** cac:TaxCategory for a TaxSubtotal/AllowanceCharge: ID, Percent, then a VATEX reason for Z/E/O. */
function taxCategory(a: ZatcaAmounts) {
  return el(
    'cac:TaxCategory',
    cbc('ID', a.category, ' schemeAgencyID="6" schemeID="UN/ECE 5305"') +
      cbc('Percent', m2(a.rate_percent)) +
      (a.category !== 'S'
        ? cbc('TaxExemptionReasonCode', a.exemption_reason_code ?? '') + cbc('TaxExemptionReason', a.exemption_reason ?? '')
        : '') +
      el('cac:TaxScheme', cbc('ID', 'VAT', ' schemeAgencyID="6" schemeID="UN/ECE 5153"')),
  );
}

export interface XmlParts {
  /** `<ext:UBLExtensions>…` — empty when hashing. */
  extensions: string;
  /** The QR `<cac:AdditionalDocumentReference>` — empty when hashing. */
  qrReference: string;
  /** `<cac:Signature>` reference — empty when hashing. */
  signatureRef: string;
}

export const NO_PARTS: XmlParts = { extensions: '', qrReference: '', signatureRef: '' };

export function qrReferenceXml(qrBase64: string): string {
  return el(
    'cac:AdditionalDocumentReference',
    cbc('ID', 'QR') +
      el('cac:Attachment', cbc('EmbeddedDocumentBinaryObject', qrBase64, ' mimeCode="text/plain"')),
  );
}

export function signatureRefXml(): string {
  return el('cac:Signature', cbc('ID', SIGNATURE_ID) + cbc('SignatureMethod', SIGNATURE_METHOD));
}

export function buildInvoiceXml(input: ZatcaDocInput, a: ZatcaAmounts, parts: XmlParts): string {
  const { date, time } = ksaDateTime(input.issue_at);
  const c = input.currency;
  const s = input.seller;
  const isNote = input.kind !== 'invoice';
  const x: string[] = [];

  x.push(
    `<Invoice xmlns="${NS_INVOICE}" xmlns:cac="${NS_CAC}" xmlns:cbc="${NS_CBC}" xmlns:ext="${NS_EXT}">`,
  );
  x.push(parts.extensions);
  x.push(cbc('ProfileID', 'reporting:1.0'));
  x.push(cbc('ID', input.invoice_no));
  x.push(cbc('UUID', input.uuid));
  x.push(cbc('IssueDate', date));
  x.push(cbc('IssueTime', time));
  // name: 0100000 = standard (B2B), 0200000 = simplified (B2C); remaining flags (third-party,
  // nominal, export, summary, self-billing) are all 0 for Sefay's POS/B2B sales.
  x.push(cbc('InvoiceTypeCode', TYPE_CODE[input.kind], ` name="${isStandardInvoice(input) ? '0100000' : '0200000'}"`));
  x.push(cbc('DocumentCurrencyCode', c));
  x.push(cbc('TaxCurrencyCode', c));
  if (isNote && input.reference_invoice_no) {
    x.push(
      el('cac:BillingReference', el('cac:InvoiceDocumentReference', cbc('ID', input.reference_invoice_no))),
    );
  }
  x.push(el('cac:AdditionalDocumentReference', cbc('ID', 'ICV') + cbc('UUID', String(input.icv))));
  x.push(
    el(
      'cac:AdditionalDocumentReference',
      cbc('ID', 'PIH') +
        el('cac:Attachment', cbc('EmbeddedDocumentBinaryObject', input.pih, ' mimeCode="text/plain"')),
    ),
  );
  x.push(parts.qrReference);
  x.push(parts.signatureRef);

  // ---- parties
  const sellerInner =
    el('cac:PartyIdentification', cbc('ID', s.crn, ` schemeID="${escAttr(s.id_scheme ?? 'CRN')}"`)) +
    el(
      'cac:PostalAddress',
      cbc('StreetName', s.street) +
        cbc('BuildingNumber', s.building_no) +
        (s.plot_id ? cbc('PlotIdentification', s.plot_id) : '') +
        cbc('CitySubdivisionName', s.district) +
        cbc('CityName', s.city) +
        cbc('PostalZone', s.postal_zone) +
        el('cac:Country', cbc('IdentificationCode', 'SA')),
    ) +
    el('cac:PartyTaxScheme', cbc('CompanyID', s.vat_number) + el('cac:TaxScheme', cbc('ID', 'VAT'))) +
    el('cac:PartyLegalEntity', cbc('RegistrationName', s.legal_name));
  x.push(el('cac:AccountingSupplierParty', party(sellerInner)));
  x.push(buildCustomerParty(input.buyer, isStandardInvoice(input)));

  // Standard (B2B) tax invoices must carry the supply date (BR-KSA-15); it defaults to the issue
  // date. Simplified invoices do not require it.
  if (isStandardInvoice(input)) {
    x.push(el('cac:Delivery', cbc('ActualDeliveryDate', date)));
  }

  // ---- payment, allowance, taxes
  x.push(
    el(
      'cac:PaymentMeans',
      cbc('PaymentMeansCode', input.payment_code) + (isNote && input.reason ? cbc('InstructionNote', input.reason) : ''),
    ),
  );
  if (a.allowance > 0) {
    x.push(
      el(
        'cac:AllowanceCharge',
        cbc('ChargeIndicator', 'false') +
          cbc('AllowanceChargeReason', 'discount') +
          cbc('Amount', m2(a.allowance), cur(c)) +
          taxCategory(a),
      ),
    );
  }
  x.push(el('cac:TaxTotal', cbc('TaxAmount', m2(a.tax), cur(c))));
  x.push(
    el(
      'cac:TaxTotal',
      cbc('TaxAmount', m2(a.tax), cur(c)) +
        el(
          'cac:TaxSubtotal',
          cbc('TaxableAmount', m2(a.taxable), cur(c)) +
            cbc('TaxAmount', m2(a.tax), cur(c)) +
            taxCategory(a),
        ),
    ),
  );
  x.push(
    el(
      'cac:LegalMonetaryTotal',
      cbc('LineExtensionAmount', m2(a.lines_net), cur(c)) +
        cbc('TaxExclusiveAmount', m2(a.taxable), cur(c)) +
        cbc('TaxInclusiveAmount', m2(a.total), cur(c)) +
        cbc('AllowanceTotalAmount', m2(a.allowance), cur(c)) +
        cbc('PrepaidAmount', '0.00', cur(c)) +
        cbc('PayableAmount', m2(a.total), cur(c)),
    ),
  );

  // ---- lines
  a.lines.forEach((l, i) => {
    x.push(
      el(
        'cac:InvoiceLine',
        cbc('ID', String(i + 1)) +
          cbc('InvoicedQuantity', qty(l.quantity), ' unitCode="PCE"') +
          cbc('LineExtensionAmount', m2(l.net), cur(c)) +
          el(
            'cac:TaxTotal',
            cbc('TaxAmount', m2(l.tax), cur(c)) + cbc('RoundingAmount', m2(l.gross), cur(c)),
          ) +
          el(
            'cac:Item',
            cbc('Name', l.name) +
              el(
                'cac:ClassifiedTaxCategory',
                cbc('ID', a.category) + cbc('Percent', m2(a.rate_percent)) + el('cac:TaxScheme', cbc('ID', 'VAT')),
              ),
          ) +
          el('cac:Price', cbc('PriceAmount', price(l.price), cur(c))),
      ),
    );
  });

  x.push('</Invoice>');
  return x.join('');
}
