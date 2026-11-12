import { X509Certificate } from 'crypto';
import { assertMatchesOrderTotal, computeZatcaAmounts } from './zatca-amounts.util';
import {
  ZATCA_FIRST_PIH,
  certInfo,
  decryptSecret,
  encryptSecret,
  generateDeviceKeyPair,
  parseTlv,
  publicKeyDer,
  sha256Base64,
  sha256Hex,
  signEcdsaSha256,
  verifyEcdsaSha256,
} from './zatca-crypto.util';
import { generateSignedDocument } from './zatca-document.service';
import { NO_PARTS, buildInvoiceXml } from './zatca-xml.builder';
import { makeTestCertificate } from './testing/test-cert';
import type { ZatcaDocInput } from './zatca.types';

const seller = {
  legal_name: 'Sefay Demo & Co <Test>',
  vat_number: '300000000000003',
  crn: '1010000000',
  street: 'King Fahd Road',
  building_no: '1234',
  district: 'Olaya',
  city: 'Riyadh',
  postal_zone: '12345',
};

const baseInput = (over: Partial<ZatcaDocInput> = {}): ZatcaDocInput => ({
  kind: 'invoice',
  invoice_no: 'INV-000001',
  uuid: '8e6000cf-1a98-4174-b3e7-b5d5954bc10d',
  icv: 1,
  pih: ZATCA_FIRST_PIH,
  issue_at: new Date('2026-11-12T04:05:09Z'), // 07:05:09 in KSA
  currency: 'SAR',
  tax_rate: 0.15,
  tax_inclusive: false,
  lines: [
    { name: 'Wash', quantity: 1, unit_price: 25, total: 25 },
    { name: 'Clean "inside" & <more>', quantity: 2, unit_price: 10, total: 20 },
  ],
  discount: 0,
  payment_code: '10',
  buyer_name: null,
  seller,
  ...over,
});

describe('crypto helpers', () => {
  it('the first PIH is the specification constant (base64 of the hex of sha256("0"))', () => {
    expect(ZATCA_FIRST_PIH).toBe(
      'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==',
    );
    expect(sha256Hex('0')).toBe('5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9');
  });

  it('signs and verifies with a secp256k1 key', () => {
    const { privateKeyPem, publicKeyPem } = generateDeviceKeyPair();
    const sig = signEcdsaSha256(privateKeyPem, Buffer.from('hello'));
    expect(verifyEcdsaSha256(publicKeyPem, Buffer.from('hello'), sig)).toBe(true);
    expect(verifyEcdsaSha256(publicKeyPem, Buffer.from('hellp'), sig)).toBe(false);
  });

  it('private keys are encrypted at rest and tampering / a wrong key is detected', () => {
    const key = Buffer.alloc(32, 7).toString('base64');
    const secret = '-----BEGIN EC PRIVATE KEY-----\nabc\n-----END EC PRIVATE KEY-----';
    const blob = encryptSecret(secret, key);
    expect(blob.startsWith('v1.')).toBe(true);
    expect(blob).not.toContain('PRIVATE KEY');
    expect(decryptSecret(blob, key)).toBe(secret);
    expect(() => decryptSecret(blob, Buffer.alloc(32, 8).toString('base64'))).toThrow();
    const tampered = blob.slice(0, -2) + (blob.endsWith('AA') ? 'BB' : 'AA');
    expect(() => decryptSecret(tampered, key)).toThrow();
    expect(() => encryptSecret('x', 'short')).toThrow(/32 bytes/);
  });

  it('reads issuer, serial and signature out of an X.509 certificate', () => {
    const { privateKeyPem } = generateDeviceKeyPair();
    const t = makeTestCertificate(privateKeyPem);
    const info = certInfo(t.certificatePem);
    expect(info.issuerName).toBe('CN=Test CA, DC=extgazt, DC=gov, DC=local');
    expect(info.serialDecimal).toBe(t.serialDecimal);
    expect(info.signatureBytes.equals(t.certSignature)).toBe(true);
    expect(publicKeyDer(t.certificatePem).length).toBeGreaterThan(80);
  });
});

describe('amounts', () => {
  it('VAT-exclusive: 45.00 + 15% = 51.75 (the receipt example)', () => {
    const a = computeZatcaAmounts(baseInput());
    expect(a.lines_net).toBe(45);
    expect(a.tax).toBe(6.75);
    expect(a.total).toBe(51.75);
    expect(a.rate_percent).toBe(15);
  });

  it('VAT-inclusive prices are split into net + VAT, with a document discount', () => {
    const a = computeZatcaAmounts(
      baseInput({ tax_inclusive: true, lines: [{ name: 'A', quantity: 2, unit_price: 11.5, total: 23 }], discount: 5.75 }),
    );
    expect(a.lines_net).toBe(20); // 23 / 1.15
    expect(a.allowance).toBe(5); // 5.75 / 1.15
    expect(a.taxable).toBe(15);
    expect(a.tax).toBe(2.25);
    expect(a.total).toBe(17.25); // 23 - 5.75
  });

  it('a free (0.00) line keeps the document consistent', () => {
    const a = computeZatcaAmounts(
      baseInput({ lines: [{ name: 'Paid', quantity: 1, unit_price: 10, total: 10 }, { name: 'Free', quantity: 1, unit_price: 0, total: 0 }] }),
    );
    expect(a.total).toBe(11.5);
    expect(a.lines[1]).toMatchObject({ net: 0, tax: 0, gross: 0 });
  });

  it('fails closed when the document disagrees with the order, and for zero-rated sales', () => {
    const a = computeZatcaAmounts(baseInput());
    expect(() => assertMatchesOrderTotal(a, 51.75, 6.75)).not.toThrow();
    expect(() => assertMatchesOrderTotal(a, 52.5, 6.75)).toThrow(/ZATCA_AMOUNT_MISMATCH/);
    expect(() => computeZatcaAmounts(baseInput({ tax_rate: 0 }))).toThrow(/ZATCA_UNSUPPORTED/);
  });
});

/** Minimal well-formedness check (balanced tags) — the builder writes compact canonical XML. */
function assertBalanced(xml: string) {
  const stack: string[] = [];
  const re = /<(\/?)([A-Za-z0-9:]+)([^>]*?)(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    if (m[4] === '/') continue;
    if (m[1] === '/') expect(stack.pop()).toBe(m[2]);
    else stack.push(m[2]);
  }
  expect(stack).toEqual([]);
}

describe('signed document', () => {
  const { privateKeyPem } = generateDeviceKeyPair();
  const cert = makeTestCertificate(privateKeyPem);
  const creds = { privateKeyPem, certificatePem: cert.certificatePem };

  it('is well formed and escapes every owner-controlled text', () => {
    const d = generateSignedDocument(baseInput(), creds);
    assertBalanced(d.xml);
    expect(d.xml).toContain('Clean "inside" &amp; &lt;more&gt;');
    expect(d.xml).toContain('Sefay Demo &amp; Co &lt;Test&gt;');
    expect(d.xml.startsWith('<Invoice xmlns=')).toBe(true);
    expect(d.xml).not.toMatch(/>\s+</); // no whitespace between elements (canonical, unambiguous)
  });

  it('carries the required references: UUID, ICV, PIH, QR, signature, type 388, KSA time', () => {
    const d = generateSignedDocument(baseInput(), creds);
    expect(d.xml).toContain('<cbc:UUID>8e6000cf-1a98-4174-b3e7-b5d5954bc10d</cbc:UUID>');
    expect(d.xml).toContain('<cbc:ID>ICV</cbc:ID><cbc:UUID>1</cbc:UUID>');
    expect(d.xml).toContain(`<cbc:ID>PIH</cbc:ID><cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${ZATCA_FIRST_PIH}<`);
    expect(d.xml).toContain(`<cbc:ID>QR</cbc:ID>`);
    expect(d.xml).toContain('<cbc:InvoiceTypeCode name="0200000">388</cbc:InvoiceTypeCode>');
    expect(d.xml).toContain('<cbc:IssueDate>2026-11-12</cbc:IssueDate><cbc:IssueTime>07:05:09</cbc:IssueTime>');
    expect(d.xml).toContain('<cac:Signature><cbc:ID>urn:oasis:names:specification:ubl:signature:Invoice</cbc:ID>');
  });

  it('the declared hash is exactly the hash of the document without its signature parts', () => {
    const d = generateSignedDocument(baseInput(), creds);
    const stripped = d.xml
      .replace(/<ext:UBLExtensions>.*?<\/ext:UBLExtensions>/, '')
      .replace(/<cac:AdditionalDocumentReference><cbc:ID>QR<\/cbc:ID>.*?<\/cac:AdditionalDocumentReference>/, '')
      .replace(/<cac:Signature>.*?<\/cac:Signature>/, '');
    expect(sha256Base64(stripped)).toBe(d.invoice_hash);
    expect(d.xml).toContain(`<ds:DigestValue>${d.invoice_hash}</ds:DigestValue>`);
  });

  it('the signature verifies with the certificate public key, and the XML carries the same value', () => {
    const d = generateSignedDocument(baseInput(), creds);
    expect(verifyEcdsaSha256(cert.certificatePem, Buffer.from(d.invoice_hash, 'base64'), d.signature)).toBe(true);
    expect(d.xml).toContain(`<ds:SignatureValue>${d.signature}</ds:SignatureValue>`);
    const certB64 = cert.certificatePem.replace(/-----[A-Z ]+-----|\s+/g, '');
    expect(d.xml).toContain(`<ds:X509Certificate>${certB64}</ds:X509Certificate>`);
    expect(new X509Certificate(cert.certificatePem).subject).toContain('EGS Test Unit');
  });

  it('the signed-properties digest in the XML matches the element written into the XML', () => {
    const d = generateSignedDocument(baseInput(), creds);
    const el = /<xades:SignedProperties .*?<\/xades:SignedProperties>/.exec(d.xml)![0];
    const digest = Buffer.from(sha256Hex(el), 'utf8').toString('base64');
    expect(d.xml).toContain(`URI="#xadesSignedProperties"><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"></ds:DigestMethod><ds:DigestValue>${digest}</ds:DigestValue>`);
    expect(el).toContain('<ds:X509IssuerName xmlns:ds="http://www.w3.org/2000/09/xmldsig#">CN=Test CA, DC=extgazt, DC=gov, DC=local</ds:X509IssuerName>');
    expect(el).toContain(`>${cert.serialDecimal}</ds:X509SerialNumber>`);
  });

  it('the QR has the 9 tags with the real values', () => {
    const d = generateSignedDocument(baseInput(), creds);
    const t = parseTlv(d.qr);
    expect([...t.keys()]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(t.get(1)!.toString()).toBe(seller.legal_name);
    expect(t.get(2)!.toString()).toBe('300000000000003');
    expect(t.get(3)!.toString()).toBe('2026-11-12T07:05:09Z');
    expect(t.get(4)!.toString()).toBe('51.75');
    expect(t.get(5)!.toString()).toBe('6.75');
    expect(t.get(6)!.toString()).toBe(d.invoice_hash);
    expect(t.get(7)!.toString()).toBe(d.signature);
    expect(t.get(8)!.equals(publicKeyDer(cert.certificatePem))).toBe(true);
    expect(t.get(9)!.equals(cert.certSignature)).toBe(true);
  });

  it('the hash chain: each document points at the previous one and any change moves the hash', () => {
    const d1 = generateSignedDocument(baseInput(), creds);
    const d2 = generateSignedDocument(baseInput({ icv: 2, pih: d1.invoice_hash, invoice_no: 'INV-000002' }), creds);
    expect(d2.pih).toBe(d1.invoice_hash);
    expect(d2.invoice_hash).not.toBe(d1.invoice_hash);
    // deterministic: same input, same hash
    expect(generateSignedDocument(baseInput(), creds).invoice_hash).toBe(d1.invoice_hash);
    // a different amount changes the hash
    const changed = baseInput({ lines: [{ name: 'Wash', quantity: 1, unit_price: 26, total: 26 }] });
    expect(generateSignedDocument(changed, creds).invoice_hash).not.toBe(d1.invoice_hash);
  });

  it('credit note: type 381 with the reference to the original invoice and the reason', () => {
    const d = generateSignedDocument(
      baseInput({ kind: 'credit_note', invoice_no: 'CN-000001', reference_invoice_no: 'INV-000001', reason: 'Customer returned the item' }),
      creds,
    );
    expect(d.xml).toContain('>381</cbc:InvoiceTypeCode>');
    expect(d.xml).toContain('<cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>INV-000001</cbc:ID>');
    expect(d.xml).toContain('<cbc:InstructionNote>Customer returned the item</cbc:InstructionNote>');
  });

  it('refuses to produce a document that disagrees with what the customer paid', () => {
    expect(() => generateSignedDocument(baseInput(), creds, { orderTotal: 99, orderTax: 6.75 })).toThrow(/ZATCA_AMOUNT_MISMATCH/);
  });

  it('the unsigned body used for hashing never contains the signature parts', () => {
    const body = buildInvoiceXml(baseInput(), computeZatcaAmounts(baseInput()), NO_PARTS);
    expect(body).not.toMatch(/UBLExtensions|<cac:Signature>|<cbc:ID>QR</);
  });
});
