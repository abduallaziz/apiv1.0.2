// ZATCA (KSA) simplified tax invoice QR: Base64 of a TLV byte string.
// Tags: 1 seller name, 2 VAT registration number, 3 ISO-8601 timestamp,
// 4 invoice total WITH VAT, 5 VAT amount. Each field = tag (1 byte) + length
// (1 byte) + UTF-8 value.
// LEGAL NOTE: the owner/accountant must confirm that this QR is required for
// the tenant (phase 1 vs phase 2 e-invoicing). Phase 2 needs more tags (hash,
// signature, public key) that are NOT produced here.

export interface ZatcaQrInput {
  sellerName: string;
  vatNumber: string;
  timestamp: Date | string;
  totalWithVat: number;
  vatAmount: number;
}

const money = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

export function tlvField(tag: number, value: string): Buffer {
  const v = Buffer.from(value, 'utf8');
  if (v.length > 255) {
    throw new RangeError(`ZATCA TLV value for tag ${tag} exceeds 255 bytes`);
  }
  return Buffer.concat([Buffer.from([tag, v.length]), v]);
}

export function buildZatcaQrBase64(input: ZatcaQrInput): string {
  // ZATCA format: YYYY-MM-DDTHH:mm:ssZ (no milliseconds), UTC.
  const ts = new Date(input.timestamp).toISOString().replace(/\.\d{3}Z$/, 'Z');
  return Buffer.concat([
    tlvField(1, input.sellerName),
    tlvField(2, input.vatNumber),
    tlvField(3, ts),
    tlvField(4, money(input.totalWithVat)),
    tlvField(5, money(input.vatAmount)),
  ]).toString('base64');
}
