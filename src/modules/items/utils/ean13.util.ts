// Real EAN-13: 12 data digits + 1 checksum digit computed per the GS1
// spec (alternating x1/x3 weights from the left, mod 10 complement).
// Auto-generated codes must be valid EAN-13 so they actually scan —
// letters (as in an earlier illustrative "TENANT001000123" example)
// are not valid in this barcode symbology.
export function computeEan13CheckDigit(digits12: string): string {
  if (!/^\d{12}$/.test(digits12)) {
    throw new Error('EAN-13 payload must be exactly 12 digits');
  }
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const digit = Number(digits12[i]);
    sum += i % 2 === 0 ? digit : digit * 3;
  }
  const check = (10 - (sum % 10)) % 10;
  return String(check);
}

// Deterministic per-tenant prefix (4 digits, derived from the tenant UUID
// so the same tenant always gets the same prefix) + an 8-digit
// zero-padded sequence from fn_next_barcode_seq, giving 12 data digits.
export function generateEan13ForTenant(
  tenantId: string,
  sequence: number,
): string {
  let hash = 0;
  for (let i = 0; i < tenantId.length; i++) {
    hash = (hash * 31 + tenantId.charCodeAt(i)) >>> 0;
  }
  const tenantPrefix = String(hash % 10000).padStart(4, '0');
  const seqPart = String(sequence % 100000000).padStart(8, '0');
  const payload = `${tenantPrefix}${seqPart}`;
  return payload + computeEan13CheckDigit(payload);
}
