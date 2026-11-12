import { assertMatchesOrderTotal, computeZatcaAmounts } from './zatca-amounts.util';
import {
  buildPhase2Qr,
  certBase64,
  certInfo,
  publicKeyDer,
  sha256Base64,
  sha256Hex,
  signEcdsaSha256,
} from './zatca-crypto.util';
import {
  NO_PARTS,
  buildInvoiceXml,
  escText,
  ksaDateTime,
  qrReferenceXml,
  signatureRefXml,
} from './zatca-xml.builder';
import type { ZatcaDeviceCredentials, ZatcaDocInput, ZatcaGeneratedDoc } from './zatca.types';

const NS_DS = 'http://www.w3.org/2000/09/xmldsig#';
const NS_XADES = 'http://uri.etsi.org/01903/v1.3.2#';
const NS_SIG = 'urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2';
const NS_SAC = 'urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2';
const NS_SBC = 'urn:oasis:names:specification:ubl:schema:xsd:SignatureBasicComponents-2';
const ALG_SHA256 = 'http://www.w3.org/2001/04/xmlenc#sha256';
const ALG_C14N11 = 'http://www.w3.org/2006/12/xml-c14n11';
const ALG_ECDSA = 'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256';
const ALG_XPATH = 'http://www.w3.org/TR/1999/REC-xpath-19991116';

/** ZATCA digests of text values are base64 of the HEX string of the SHA-256 (specification quirk). */
const hexDigestB64 = (text: string) => Buffer.from(sha256Hex(text), 'utf8').toString('base64');

/**
 * The xades:SignedProperties element in its canonical standalone form. The very same bytes are
 * written into the document and hashed, so there is no whitespace or namespace ambiguity between
 * what we sign and what we send. (Namespace handling of this element is the first thing to check
 * against ZATCA's sandbox validator.)
 */
function signedPropertiesCanonical(signingTime: string, certDigest: string, issuer: string, serial: string): string {
  const ds = (name: string, content: string, attrs = '') =>
    `<ds:${name} xmlns:ds="${NS_DS}"${attrs}>${content}</ds:${name}>`;
  return (
    `<xades:SignedProperties xmlns:xades="${NS_XADES}" Id="xadesSignedProperties">` +
    `<xades:SignedSignatureProperties>` +
    `<xades:SigningTime>${signingTime}</xades:SigningTime>` +
    `<xades:SigningCertificate><xades:Cert>` +
    `<xades:CertDigest>${ds('DigestMethod', '', ` Algorithm="${ALG_SHA256}"`)}${ds('DigestValue', certDigest)}</xades:CertDigest>` +
    `<xades:IssuerSerial>${ds('X509IssuerName', escText(issuer))}${ds('X509SerialNumber', serial)}</xades:IssuerSerial>` +
    `</xades:Cert></xades:SigningCertificate>` +
    `</xades:SignedSignatureProperties></xades:SignedProperties>`
  );
}

function extensionsXml(args: {
  invoiceHash: string;
  signedPropertiesHash: string;
  signatureValue: string;
  certificate: string;
  signedProperties: string;
}): string {
  const xpath = (expr: string) =>
    `<ds:Transform Algorithm="${ALG_XPATH}"><ds:XPath>${expr}</ds:XPath></ds:Transform>`;
  return (
    `<ext:UBLExtensions><ext:UBLExtension>` +
    `<ext:ExtensionURI>urn:oasis:names:specification:ubl:dsig:enveloped:xades</ext:ExtensionURI>` +
    `<ext:ExtensionContent>` +
    `<sig:UBLDocumentSignatures xmlns:sac="${NS_SAC}" xmlns:sbc="${NS_SBC}" xmlns:sig="${NS_SIG}">` +
    `<sac:SignatureInformation>` +
    `<cbc:ID>urn:oasis:names:specification:ubl:signature:1</cbc:ID>` +
    `<sbc:ReferencedSignatureID>urn:oasis:names:specification:ubl:signature:Invoice</sbc:ReferencedSignatureID>` +
    `<ds:Signature xmlns:ds="${NS_DS}" Id="signature">` +
    `<ds:SignedInfo>` +
    `<ds:CanonicalizationMethod Algorithm="${ALG_C14N11}"></ds:CanonicalizationMethod>` +
    `<ds:SignatureMethod Algorithm="${ALG_ECDSA}"></ds:SignatureMethod>` +
    `<ds:Reference Id="invoiceSignedData" URI="">` +
    `<ds:Transforms>` +
    xpath('not(//ancestor-or-self::ext:UBLExtensions)') +
    xpath('not(//ancestor-or-self::cac:Signature)') +
    xpath("not(//ancestor-or-self::cac:AdditionalDocumentReference[cbc:ID='QR'])") +
    `<ds:Transform Algorithm="${ALG_C14N11}"></ds:Transform>` +
    `</ds:Transforms>` +
    `<ds:DigestMethod Algorithm="${ALG_SHA256}"></ds:DigestMethod>` +
    `<ds:DigestValue>${args.invoiceHash}</ds:DigestValue>` +
    `</ds:Reference>` +
    `<ds:Reference Type="http://www.w3.org/2000/09/xmldsig#SignatureProperties" URI="#xadesSignedProperties">` +
    `<ds:DigestMethod Algorithm="${ALG_SHA256}"></ds:DigestMethod>` +
    `<ds:DigestValue>${args.signedPropertiesHash}</ds:DigestValue>` +
    `</ds:Reference>` +
    `</ds:SignedInfo>` +
    `<ds:SignatureValue>${args.signatureValue}</ds:SignatureValue>` +
    `<ds:KeyInfo><ds:X509Data><ds:X509Certificate>${args.certificate}</ds:X509Certificate></ds:X509Data></ds:KeyInfo>` +
    `<ds:Object><xades:QualifyingProperties xmlns:xades="${NS_XADES}" Target="signature">` +
    args.signedProperties +
    `</xades:QualifyingProperties></ds:Object>` +
    `</ds:Signature>` +
    `</sac:SignatureInformation>` +
    `</sig:UBLDocumentSignatures>` +
    `</ext:ExtensionContent></ext:UBLExtension></ext:UBLExtensions>`
  );
}

export interface GenerateOptions {
  /** The order's stored figures; generation fails if they do not match the document. */
  orderTotal?: number;
  orderTax?: number;
  /** Fixed signing time (tests). */
  signingTime?: Date;
}

/**
 * Prepares the complete, signed ZATCA document for one sale. Pure: no I/O, no network.
 * The result is stored as-is and sent unchanged once the connection exists.
 */
export function generateSignedDocument(
  input: ZatcaDocInput,
  creds: ZatcaDeviceCredentials,
  opts: GenerateOptions = {},
): ZatcaGeneratedDoc {
  const amounts = computeZatcaAmounts(input);
  if (opts.orderTotal !== undefined && opts.orderTax !== undefined) {
    assertMatchesOrderTotal(amounts, opts.orderTotal, opts.orderTax);
  }

  // 1) hash of the canonical unsigned invoice (the next document's PIH)
  const hashInput = buildInvoiceXml(input, amounts, NO_PARTS);
  const invoiceHash = sha256Base64(hashInput);

  // 2) ECDSA signature over the hash bytes
  const signature = signEcdsaSha256(creds.privateKeyPem, Buffer.from(invoiceHash, 'base64'));

  // 3) XAdES signed properties
  const cert = certInfo(creds.certificatePem);
  const certB64 = certBase64(creds.certificatePem);
  const signingTime = (opts.signingTime ?? input.issue_at).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const signedProperties = signedPropertiesCanonical(
    signingTime,
    hexDigestB64(certB64),
    cert.issuerName,
    cert.serialDecimal,
  );
  const signedPropertiesHash = hexDigestB64(signedProperties);

  // 4) phase-2 QR (9 tags)
  const { date, time } = ksaDateTime(input.issue_at);
  const qr = buildPhase2Qr({
    sellerName: input.seller.legal_name,
    vatNumber: input.seller.vat_number,
    timestamp: `${date}T${time}Z`,
    totalWithVat: amounts.total.toFixed(2),
    vatAmount: amounts.tax.toFixed(2),
    invoiceHash,
    signature,
    publicKeyDer: publicKeyDer(creds.certificatePem),
    certSignature: cert.signatureBytes,
  });

  // 5) final document
  const xml = buildInvoiceXml(input, amounts, {
    extensions: extensionsXml({
      invoiceHash,
      signedPropertiesHash,
      signatureValue: signature,
      certificate: certB64,
      signedProperties,
    }),
    qrReference: qrReferenceXml(qr),
    signatureRef: signatureRefXml(),
  });

  return { uuid: input.uuid, icv: input.icv, pih: input.pih, invoice_hash: invoiceHash, signature, qr, xml };
}
