import * as bwipjs from 'bwip-js';

const SYMBOLOGY_BY_TYPE: Record<string, string> = {
  UPC: 'upca',
  EAN: 'ean13',
  GS1: 'gs1-128',
  QR: 'qrcode',
};

// Renders the barcode itself as an SVG string. bwip-js is strict about
// payload shape per symbology (e.g. ean13 requires 12-13 digits) — real
// tenant data can be manually entered or imported and not always match
// exactly, so a rendering failure on the "correct" symbology falls back to
// code128 (accepts arbitrary alphanumeric input) rather than erroring out.
// This is a rendering-robustness fallback only, not a validation change —
// item_barcodes.barcode_type on the row is never altered.
function renderBarcodeSvg(barcode: string, barcodeType: string): string {
  const bcid = SYMBOLOGY_BY_TYPE[barcodeType] ?? 'code128';
  try {
    return bwipjs.toSVG({ bcid, text: barcode, includetext: false, scale: 2 });
  } catch {
    return bwipjs.toSVG({ bcid: 'code128', text: barcode, includetext: false, scale: 2 });
  }
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface LabelData {
  barcode: string;
  barcodeType: string;
  itemName: string;
  variantName?: string | null;
}

// Composes a self-contained, printable label: item name (+ variant, if
// any) above the barcode, the raw barcode value and type below it. Pure
// rendering — no persistence, no lookup logic beyond what's passed in.
export function renderBarcodeLabelSvg(data: LabelData): string {
  const barcodeSvg = renderBarcodeSvg(data.barcode, data.barcodeType);
  const title = data.variantName
    ? `${data.itemName} — ${data.variantName}`
    : data.itemName;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="180" viewBox="0 0 300 180">
<rect width="100%" height="100%" fill="#ffffff"/>
<text x="150" y="18" text-anchor="middle" font-size="13" font-family="Arial, sans-serif" fill="#000000">${escapeXml(title)}</text>
<g transform="translate(30,28) scale(0.85)">
${barcodeSvg}
</g>
<text x="150" y="152" text-anchor="middle" font-size="12" font-family="monospace" fill="#000000">${escapeXml(data.barcode)}</text>
<text x="150" y="168" text-anchor="middle" font-size="10" font-family="Arial, sans-serif" fill="#666666">${escapeXml(data.barcodeType)}</text>
</svg>`;
}
