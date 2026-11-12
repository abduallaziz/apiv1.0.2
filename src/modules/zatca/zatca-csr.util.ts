import { createPrivateKey, createPublicKey, createSign } from 'crypto';
import {
  derBitString,
  derInt,
  derOctet,
  derOid,
  derPrintable,
  derSeq,
  derSet,
  derTlv,
  derUtf8,
  pem,
} from './der.util';
import type { ZatcaEnv } from './zatca.types';

// Certificate Signing Request (PKCS#10) for a ZATCA EGS unit, built exactly as ZATCA's SDK config
// describes it: subject C/OU/O/CN, the certificate-template extension, and a subjectAltName
// directoryName carrying SN (EGS serial), UID (VAT number), title (invoice types), registeredAddress
// and businessCategory. Signed ECDSA/SHA-256 with the device key (secp256k1).
// The Compliance CSID request (needs the OTP from the Fatoora portal) takes this PEM as is.

const OID = {
  ecdsaSha256: '1.2.840.10045.4.3.2',
  country: '2.5.4.6',
  orgUnit: '2.5.4.11',
  org: '2.5.4.10',
  commonName: '2.5.4.3',
  surname: '2.5.4.4', // ZATCA stores the EGS serial in SN
  uid: '0.9.2342.19200300.100.1.1',
  title: '2.5.4.12',
  registeredAddress: '2.5.4.26',
  businessCategory: '2.5.4.15',
  subjectAltName: '2.5.29.17',
  extensionRequest: '1.2.840.113549.1.9.14',
  templateName: '1.3.6.1.4.1.311.20.2',
};

export const TEMPLATE_BY_ENV: Record<ZatcaEnv, string> = {
  sandbox: 'TSTZATCA-Code-Signing',
  simulation: 'PREZATCA-Code-Signing',
  production: 'ZATCA-Code-Signing',
};

export interface CsrInput {
  env: ZatcaEnv;
  /** Organization unit: the branch name (or the VAT number of the group member). */
  organizationUnit: string;
  /** The taxpayer's legal name. */
  organization: string;
  /** The EGS unit's name (common name). */
  commonName: string;
  /** e.g. "1-Sefay|2-POS|3-<uuid>" */
  egsSerial: string;
  vatNumber: string;
  /** 4 flags: standard, simplified, future, future — "0100" = simplified only, "1100" = both. */
  invoiceTypes: string;
  address: string;
  businessCategory: string;
}

const rdn = (oid: string, value: Buffer) => derSet(derSeq(derOid(oid), value));

export function buildCsr(privateKeyPem: string, i: CsrInput): { pem: string; info: Buffer; signature: Buffer } {
  if (!/^[01]{4}$/.test(i.invoiceTypes)) throw new Error('invoiceTypes must be 4 digits of 0/1');
  const key = createPrivateKey(privateKeyPem);
  const spki = createPublicKey(key).export({ type: 'spki', format: 'der' }) as Buffer;

  const subject = derSeq(
    rdn(OID.country, derPrintable('SA')),
    rdn(OID.orgUnit, derUtf8(i.organizationUnit)),
    rdn(OID.org, derUtf8(i.organization)),
    rdn(OID.commonName, derUtf8(i.commonName)),
  );

  // [4] directoryName
  const dirName = derTlv(
    0xa4,
    derSeq(
      rdn(OID.surname, derUtf8(i.egsSerial)),
      rdn(OID.uid, derUtf8(i.vatNumber)),
      rdn(OID.title, derUtf8(i.invoiceTypes)),
      rdn(OID.registeredAddress, derUtf8(i.address)),
      rdn(OID.businessCategory, derUtf8(i.businessCategory)),
    ),
  );
  const san = derSeq(derOid(OID.subjectAltName), derOctet(derSeq(dirName)));
  const template = derSeq(derOid(OID.templateName), derOctet(derPrintable(TEMPLATE_BY_ENV[i.env])));
  const extensions = derSeq(template, san);
  const attributes = derTlv(0xa0, derSeq(derOid(OID.extensionRequest), derSet(extensions)));

  const info = derSeq(derInt(Buffer.from([0])), subject, spki, attributes);
  const signature = createSign('sha256').update(info).sign(key);
  const csr = derSeq(info, derSeq(derOid(OID.ecdsaSha256)), derBitString(signature));
  return { pem: pem('CERTIFICATE REQUEST', csr), info, signature };
}
