// Minimal DER (ASN.1) writer — just enough to build a ZATCA certificate request (CSR) and the
// test certificate. Node's crypto cannot create either, and no dependency is worth adding for it.
export const derLen = (n: number): Buffer => {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  for (let v = n; v > 0; v >>= 8) bytes.unshift(v & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
};
export const derTlv = (tag: number, ...parts: Buffer[]): Buffer => {
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([tag]), derLen(body.length), body]);
};
export const derSeq = (...p: Buffer[]) => derTlv(0x30, ...p);
export const derSet = (...p: Buffer[]) => derTlv(0x31, ...p);
export const derOid = (s: string): Buffer => {
  const n = s.split('.').map(Number);
  const out = [n[0] * 40 + n[1]];
  for (const v of n.slice(2)) {
    const stack = [v & 0x7f];
    for (let x = v >> 7; x > 0; x >>= 7) stack.unshift((x & 0x7f) | 0x80);
    out.push(...stack);
  }
  return derTlv(0x06, Buffer.from(out));
};
export const derUtf8 = (s: string) => derTlv(0x0c, Buffer.from(s, 'utf8'));
export const derPrintable = (s: string) => derTlv(0x13, Buffer.from(s, 'ascii'));
export const derIa5 = (s: string) => derTlv(0x16, Buffer.from(s, 'ascii'));
export const derInt = (b: Buffer) => derTlv(0x02, b[0] & 0x80 ? Buffer.concat([Buffer.from([0]), b]) : b);
export const derUtc = (d: Date) =>
  derTlv(0x17, Buffer.from(d.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z', 'ascii'));
export const derBitString = (b: Buffer) => derTlv(0x03, Buffer.concat([Buffer.from([0]), b]));
export const derOctet = (b: Buffer) => derTlv(0x04, b);

export function pem(label: string, der: Buffer): string {
  const b64 = der.toString('base64').match(/.{1,64}/g)!.join('\n');
  return `-----BEGIN ${label}-----\n${b64}\n-----END ${label}-----\n`;
}
