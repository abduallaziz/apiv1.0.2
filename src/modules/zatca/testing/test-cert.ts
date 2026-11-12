// TEST-ONLY helper: mints a self-signed X.509 certificate for a secp256k1 key (Node cannot create
// certificates). Used by the specs and the local check scripts to exercise the whole signing path
// before a real ZATCA CSID exists. Never used by production code.
import { createPrivateKey, createPublicKey, createSign, randomBytes } from 'crypto';

import {
  derBitString as bitString,
  derInt as int,
  derOid as oid,
  derIa5 as ia5,
  derSeq as seq,
  derSet as set,
  derTlv as tlv,
  derUtc as utc,
  derUtf8 as utf8,
} from '../der.util';

const OID_ECDSA_SHA256 = '1.2.840.10045.4.3.2';
const OID_CN = '2.5.4.3';
const OID_DC = '0.9.2342.19200300.100.1.25';

const rdnCn = (v: string) => set(seq(oid(OID_CN), utf8(v)));
const rdnDc = (v: string) => set(seq(oid(OID_DC), ia5(v)));

export interface TestCert {
  certificatePem: string;
  /** The signature bytes we put in the certificate (tag 9 of the QR). */
  certSignature: Buffer;
  /** decimal serial */
  serialDecimal: string;
}

export function makeTestCertificate(privateKeyPem: string): TestCert {
  const key = createPrivateKey(privateKeyPem);
  const spki = createPublicKey(key).export({ type: 'spki', format: 'der' }) as Buffer;
  const serial = randomBytes(8);
  serial[0] &= 0x7f;
  serial[0] |= 0x01;
  const algId = seq(oid(OID_ECDSA_SHA256));
  // same shape as ZATCA's CA: CN=…, DC=extgazt, DC=gov, DC=local  (certificate order: DC=local first)
  const issuer = seq(rdnDc('local'), rdnDc('gov'), rdnDc('extgazt'), rdnCn('Test CA'));
  const subject = seq(rdnCn('EGS Test Unit'));
  const now = new Date();
  const tbs = seq(
    tlv(0xa0, int(Buffer.from([2]))), // v3
    int(serial),
    algId,
    issuer,
    seq(utc(new Date(now.getTime() - 3600_000)), utc(new Date(now.getTime() + 365 * 86400_000))),
    subject,
    spki,
  );
  const sig = createSign('sha256').update(tbs).sign(key);
  const cert = seq(tbs, algId, bitString(sig));
  const b64 = cert.toString('base64').match(/.{1,64}/g)!.join('\n');
  return {
    certificatePem: `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n`,
    certSignature: sig,
    serialDecimal: BigInt('0x' + serial.toString('hex')).toString(10),
  };
}
