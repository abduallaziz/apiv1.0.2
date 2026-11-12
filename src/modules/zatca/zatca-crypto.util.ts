import {
  X509Certificate,
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  createSign,
  createVerify,
  generateKeyPairSync,
  randomBytes,
} from 'crypto';

// Pure crypto helpers for ZATCA phase 2. Node's own crypto supports the secp256k1 curve
// ZATCA mandates, so no extra dependency is needed.

/**
 * The first document of every device chains to a fixed constant: base64 of the HEX text of
 * sha256("0") (NWZlY2Vi…). Later documents chain to the previous invoice hash (base64 of the digest).
 */
export const ZATCA_FIRST_PIH = Buffer.from(
  createHash('sha256').update('0', 'utf8').digest('hex'),
  'utf8',
).toString('base64');

export function sha256Base64(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('base64');
}
export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/** New EGS key pair (secp256k1). The private key is returned as PEM for immediate encryption. */
export function generateDeviceKeyPair(): { privateKeyPem: string; publicKeyPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
  return {
    privateKeyPem: privateKey.export({ type: 'sec1', format: 'pem' }).toString(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

/** ECDSA / SHA-256 signature (DER) of `data`, base64. */
export function signEcdsaSha256(privateKeyPem: string, data: Buffer): string {
  return createSign('sha256').update(data).sign(createPrivateKey(privateKeyPem)).toString('base64');
}

export function verifyEcdsaSha256(publicKeyPemOrCert: string, data: Buffer, signatureB64: string): boolean {
  const key = publicKeyPemOrCert.includes('BEGIN CERTIFICATE')
    ? new X509Certificate(publicKeyPemOrCert).publicKey
    : createPublicKey(publicKeyPemOrCert);
  return createVerify('sha256').update(data).verify(key, Buffer.from(signatureB64, 'base64'));
}

/** Raw DER bytes of the certificate's public key (SubjectPublicKeyInfo) — QR tag 8. */
export function publicKeyDer(certPem: string): Buffer {
  return new X509Certificate(certPem).publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
}

/** The certificate text without the PEM armour and newlines (what goes in <ds:X509Certificate>). */
export function certBase64(certPem: string): string {
  return certPem
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '');
}

export interface CertInfo {
  /** RFC 2253 style, most specific first: "CN=…, DC=…, DC=…". */
  issuerName: string;
  /** Decimal serial number. */
  serialDecimal: string;
  /** Raw certificate signature bytes (QR tag 9). */
  signatureBytes: Buffer;
}

export function certInfo(certPem: string): CertInfo {
  const c = new X509Certificate(certPem);
  // Node prints the issuer one RDN per line in certificate order; RFC 2253 reverses it.
  const issuerName = c.issuer.split('\n').reverse().join(', ');
  const serialDecimal = BigInt('0x' + c.serialNumber).toString(10);
  return { issuerName, serialDecimal, signatureBytes: extractCertSignature(c.raw) };
}

/** The outer signatureValue BIT STRING of an X.509 certificate (minimal DER walk). */
function extractCertSignature(der: Buffer): Buffer {
  const readLen = (b: Buffer, o: number): [number, number] => {
    const first = b[o];
    if (first < 0x80) return [first, 1];
    const n = first & 0x7f;
    let len = 0;
    for (let i = 0; i < n; i++) len = (len << 8) | b[o + 1 + i];
    return [len, 1 + n];
  };
  // Certificate ::= SEQUENCE { tbsCertificate, signatureAlgorithm, signatureValue }
  let o = 1;
  const [, seqLenBytes] = readLen(der, o);
  o += seqLenBytes;
  const skip = () => {
    // tag at o, then length, then content
    const [len, lb] = readLen(der, o + 1);
    o += 1 + lb + len;
  };
  skip(); // tbsCertificate
  skip(); // signatureAlgorithm
  const [bitLen, bitLenBytes] = readLen(der, o + 1);
  const start = o + 1 + bitLenBytes;
  // first content byte of a BIT STRING = number of unused bits (0)
  return der.subarray(start + 1, start + bitLen);
}

// ---- TLV / QR (9 tags) -------------------------------------------------------------------
export function tlv(tag: number, value: Buffer | string): Buffer {
  const v = typeof value === 'string' ? Buffer.from(value, 'utf8') : value;
  if (v.length > 255) throw new RangeError(`ZATCA TLV value for tag ${tag} exceeds 255 bytes`);
  return Buffer.concat([Buffer.from([tag, v.length]), v]);
}

export interface Phase2QrInput {
  sellerName: string;
  vatNumber: string;
  /** `YYYY-MM-DDTHH:mm:ssZ` */
  timestamp: string;
  totalWithVat: string;
  vatAmount: string;
  /** base64 hash of the invoice */
  invoiceHash: string;
  /** base64 ECDSA signature */
  signature: string;
  publicKeyDer: Buffer;
  certSignature: Buffer;
}

export function buildPhase2Qr(i: Phase2QrInput): string {
  return Buffer.concat([
    tlv(1, i.sellerName),
    tlv(2, i.vatNumber),
    tlv(3, i.timestamp),
    tlv(4, i.totalWithVat),
    tlv(5, i.vatAmount),
    tlv(6, i.invoiceHash),
    tlv(7, i.signature),
    tlv(8, i.publicKeyDer),
    tlv(9, i.certSignature),
  ]).toString('base64');
}

/** Reads a TLV base64 back into tag -> bytes (used by tests and the support tools). */
export function parseTlv(b64: string): Map<number, Buffer> {
  const buf = Buffer.from(b64, 'base64');
  const out = new Map<number, Buffer>();
  for (let i = 0; i < buf.length; ) {
    const tag = buf[i];
    const len = buf[i + 1];
    out.set(tag, buf.subarray(i + 2, i + 2 + len));
    i += 2 + len;
  }
  return out;
}

// ---- secrets at rest (private keys, CSID secrets) -----------------------------------------
// Format: v1.<iv>.<tag>.<ciphertext>, all base64url. AES-256-GCM; the master key comes from
// ZATCA_KEY_ENC_KEY (32 bytes as base64 or 64 hex chars). Never log the plaintext or the key.
function masterKey(raw: string): Buffer {
  const k = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (k.length !== 32) throw new Error('ZATCA_KEY_ENC_KEY must be 32 bytes (base64 or 64 hex chars)');
  return k;
}

export function encryptSecret(plain: string, masterKeyRaw: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', masterKey(masterKeyRaw), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  const parts = [iv, c.getAuthTag(), enc].map((b) => b.toString('base64url'));
  return ['v1', ...parts].join('.');
}

export function decryptSecret(blob: string, masterKeyRaw: string): string {
  const [v, iv, tag, enc] = blob.split('.');
  if (v !== 'v1' || !iv || !tag || !enc) throw new Error('unsupported secret format');
  const d = createDecipheriv('aes-256-gcm', masterKey(masterKeyRaw), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(enc, 'base64url')), d.final()]).toString('utf8');
}
