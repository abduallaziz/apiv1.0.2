// SKU is a fully separate identity system from item_barcodes/ean13.util.ts —
// different format (plain numeric sequence, not EAN-13), different sequence
// tables (migration 139), no shared state with barcode generation.

export function formatProductSku(sequence: number): string {
  return String(sequence % 10000000).padStart(7, '0');
}

export function formatVariantSku(parentSku: string, sequence: number): string {
  return `${parentSku}-${String(sequence % 100).padStart(2, '0')}`;
}
