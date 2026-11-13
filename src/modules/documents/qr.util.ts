import qrcode from 'qrcode-generator';

// Document Template Builder, Phase 9: QR rendering + the scannability guard.
// The QR is drawn as inline SVG (vector: stays sharp in print, no image to fetch), black on white
// with the mandatory 4-module quiet zone, error correction M. Content is decided by the BACKEND
// (verification URL, ZATCA TLV, payment text or a validated https URL) — a template only chooses
// the kind and where to put it.

export const QR_KINDS = [
  'verification',
  'zatca',
  'payment',
  'custom_url',
] as const;
export type QrKind = (typeof QR_KINDS)[number];

const QUIET_MODULES = 4;
/** Smallest printable module (mm). Below this, common scanners start to fail. */
const MIN_MODULE_MM = 0.4;
/** A QR must stay (almost) opaque and square to remain scannable. */
export const QR_MIN_OPACITY = 0.85;
const SQUARE_TOLERANCE = 0.05;

export const MAX_QR_PAYLOAD = 1000;

/** Representative payload sizes used to size a QR before its real content exists. */
const TYPICAL_LENGTH: Record<Exclude<QrKind, 'custom_url'>, number> = {
  verification: 90,
  zatca: 400,
  payment: 140,
};

export function qrModules(payload: string): number {
  const qr = qrcode(0, 'M');
  qr.addData(payload, 'Byte');
  qr.make();
  return qr.getModuleCount();
}

/** Smallest side (mm) at which a QR with this many modules is reliably scannable. */
export function minSideMm(modules: number): number {
  return Math.ceil((modules + QUIET_MODULES * 2) * MIN_MODULE_MM * 10) / 10;
}

export function minQrSizeMm(kind: QrKind, customUrl?: string): number {
  const len =
    kind === 'custom_url' ? (customUrl ?? '').length : TYPICAL_LENGTH[kind];
  return minSideMm(
    qrModules('x'.repeat(Math.max(1, Math.min(len, MAX_QR_PAYLOAD)))),
  );
}

/** Static checks done when a template is saved. Returns a message, or null when fine. */
export function qrGeometryProblem(
  kind: QrKind,
  size: { width: number; height: number } | undefined,
  opacity: number | undefined,
  customUrl?: string,
): string | null {
  if (opacity !== undefined && opacity < QR_MIN_OPACITY) {
    return `QR opacity must be at least ${QR_MIN_OPACITY}`;
  }
  if (size) {
    if (
      Math.abs(size.width - size.height) >
      Math.max(size.width, size.height) * SQUARE_TOLERANCE
    ) {
      return 'QR code must be square';
    }
    const min = minQrSizeMm(kind, customUrl);
    if (Math.min(size.width, size.height) < min) {
      return `QR code is too small to scan: use at least ${min} mm`;
    }
  }
  return null;
}

/** Only https URLs, no credentials, bounded length: the only free-form QR content allowed. */
export function isSafeHttpsUrl(url: string): boolean {
  if (url.length === 0 || url.length > 500) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** Inline SVG of the QR for `payload`; the caller sizes it via CSS (100% of its box). */
export function qrSvg(payload: string): { svg: string; modules: number } {
  const qr = qrcode(0, 'M');
  qr.addData(payload, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  const total = n + QUIET_MODULES * 2;
  let path = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c))
        path += `M${c + QUIET_MODULES} ${r + QUIET_MODULES}h1v1h-1z`;
    }
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" ` +
    `width="100%" height="100%" shape-rendering="crispEdges">` +
    `<rect width="${total}" height="${total}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
  return { svg, modules: n };
}
