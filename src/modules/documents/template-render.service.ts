import { Injectable } from '@nestjs/common';
import {
  BINDING_PATHS,
  filterResolvedData,
  sectionFields,
} from './bindings.catalog';
import { isSafeHttpsUrl, minSideMm, qrSvg } from './qr.util';

// Document Template Builder, Phase 4: the render engine. ONE function turns a template body plus
// backend-resolved data into a single HTML string; that same string feeds the editor preview, the
// PDF (headless Chrome) and printing, so canvas == PDF (design A2).
//
// Safety rules (design A4/A8):
//  - the template body is data, never code: every value is HTML-escaped, there are no scripts;
//  - financial values only come from `data` (computed by the backend) and are printed as given;
//  - image sources must be https: or data:image URLs (signed URLs); anything else is dropped;
//  - numbers are always English numerals (toFixed, no locale formatting).

export type RenderDirection = 'rtl' | 'ltr';

export interface RenderElement {
  id?: string;
  page?: number;
  type: string;
  region?: 'flow' | 'overlay';
  assetId?: string;
  config?: Record<string, unknown>;
  position?: { x: number; y: number };
  size?: { width: number; height: number };
  rotation?: number;
  opacity?: number;
  zIndex?: number;
  visible?: boolean;
  /** 'first' (default): page 1 only; 'every': repeated on every printed page. */
  anchor?: 'first' | 'every';
}

export interface RenderBody {
  /** What an unresolved/empty binding prints: nothing (default) or an em dash. */
  missingValue?: 'blank' | 'dash';
  pages?: Array<{
    size?: string;
    orientation?: string;
    marginsMm?: {
      top?: number;
      right?: number;
      bottom?: number;
      left?: number;
    };
  }>;
  elements?: RenderElement[];
}

export interface RenderInput {
  body: RenderBody;
  paper: string;
  orientation: string;
  direction: RenderDirection;
  /** Backend-resolved values (company, customer, document, items, totals ...). */
  data: Record<string, unknown>;
  /** assetId -> short-lived signed URL, resolved server-side after tenant checks. */
  assetUrls: Record<string, string>;
  /** Editor canvas draws the overlays itself (live drag); preview/PDF never set this. */
  omitOverlays?: boolean;
  /** QR contents decided by the backend (never by the template). */
  qr?: { verificationUrl?: string; zatca?: string; payment?: string };
  /** Collects non-fatal problems (e.g. a QR too small to scan) for the editor/preview. */
  warnings?: string[];
}

const PAPER_MM: Record<string, { w: number; h: number | null }> = {
  A4: { w: 210, h: 297 },
  A5: { w: 148, h: 210 },
  '80mm': { w: 80, h: null }, // roll: height follows the content
  '58mm': { w: 58, h: null },
};

const str = (v: unknown): string =>
  typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
    ? String(v)
    : '';

export const escapeHtml = (v: unknown): string =>
  str(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n));

/** Own-property path lookup ("customer.name"); never walks the prototype chain. */
export function lookup(data: Record<string, unknown>, path: string): unknown {
  let cur: unknown = data;
  for (const part of path.split('.')) {
    if (
      cur === null ||
      typeof cur !== 'object' ||
      !Object.prototype.hasOwnProperty.call(cur, part)
    ) {
      return undefined;
    }
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Display form of a resolved value: numbers with 2 decimals, English digits. */
export function display(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? v.toFixed(2) : '';
  if (typeof v === 'string' || typeof v === 'boolean') return String(v);
  return '';
}

/** {{path}} placeholders resolved from data; unknown paths become empty. Output is escaped. */
export function interpolate(
  text: string,
  data: Record<string, unknown>,
  missing = '',
): string {
  return escapeHtml(text).replace(
    /\{\{\s*([\w.]+)\s*\}\}/g,
    (_m, p: string) => {
      // only whitelisted bindings resolve; everything else is the configured placeholder
      const v = BINDING_PATHS.has(p) ? display(lookup(data, p)) : '';
      return escapeHtml(v === '' ? missing : v);
    },
  );
}

function safeImageUrl(url: string | undefined): string | null {
  if (!url) return null;
  return /^(https:\/\/|data:image\/(png|jpeg|webp);base64,)/i.test(url)
    ? url
    : null;
}

@Injectable()
export class TemplateRenderService {
  render(raw: RenderInput): string {
    // only whitelisted data ever reaches the HTML (design §8)
    const input: RenderInput = { ...raw, data: filterResolvedData(raw.data) };
    const paper = PAPER_MM[input.paper] ?? PAPER_MM.A4;
    const landscape = input.orientation === 'landscape' && paper.h !== null;
    const widthMm = landscape ? paper.h : paper.w;
    const heightMm = landscape ? paper.w : paper.h;
    const pages = input.body.pages?.length ? input.body.pages : [{}];
    const elements = (input.body.elements ?? []).filter(
      (e) => e.visible !== false,
    );

    const pageHtml = pages
      .map((p, idx) => {
        const m = p.marginsMm ?? {};
        const pad = [m.top, m.right, m.bottom, m.left].map((x) =>
          clamp(num(x, 10), 0, 60),
        );
        const mine = elements.filter((e) => num(e.page, 0) === idx);
        const flow = mine
          .filter((e) => e.region !== 'overlay' && !isOverlayType(e.type))
          .map((e) => wrapFlow(e, this.flowElement(e, input)))
          .join('');
        const overlay = input.omitOverlays
          ? ''
          : mine
              .filter((e) => e.region === 'overlay' || isOverlayType(e.type))
              .sort((a, b) => num(a.zIndex, 0) - num(b.zIndex, 0))
              .map((e) => this.overlayElement(e, input))
              .join('');
        const [mt, mr, mb, ml] = pad;
        // The flow sits in a table whose empty thead/tfoot rows repeat on every printed page: that
        // gives continuation pages the same top/bottom margins as page 1 (left/right via padding).
        return (
          `<section class="page"><table class="frame">` +
          `<thead><tr><td style="height:${mt}mm;padding:0"></td></tr></thead>` +
          `<tbody><tr><td style="padding:0 ${mr}mm 0 ${ml}mm"><div class="flow">${flow}</div></td></tr></tbody>` +
          `<tfoot><tr><td style="height:${mb}mm;padding:0"></td></tr></tfoot>` +
          `</table>${overlay}</section>`
        );
      })
      .join('');

    const size = heightMm ? `${widthMm}mm ${heightMm}mm` : `${widthMm}mm auto`;
    return (
      `<!doctype html><html lang="${input.direction === 'rtl' ? 'ar' : 'en'}" dir="${input.direction}">` +
      `<head><meta charset="utf-8"><title>document</title><style>${css(widthMm, heightMm, size)}</style></head>` +
      `<body>${pageHtml}</body></html>`
    );
  }

  // ---------------------------------------------------------------- flow (structured) elements

  private flowElement(e: RenderElement, input: RenderInput): string {
    const c = e.config ?? {};
    const data = input.data;
    const missing = input.body.missingValue === 'dash' ? '—' : '';
    const lang = input.direction === 'rtl' ? 'ar' : 'en';
    switch (e.type) {
      case 'heading':
        return `<h1>${interpolate(str(c.text), data, missing)}</h1>`;
      case 'text':
      case 'terms':
      case 'footer':
        return `<div class="text ${e.type}">${interpolate(str(c.text), data, missing).replace(/\n/g, '<br>')}</div>`;
      case 'divider':
        return '<hr>';
      case 'page_break':
        return '<div class="pagebreak"></div>';
      case 'company_info':
        return kv('company', data, lang);
      case 'customer_info':
        return kv('customer', data, lang);
      case 'document_info':
        return kv('document', data, lang);
      case 'payment_details':
        return kv('payment', data, lang);
      case 'items_table':
        return this.itemsTable(c, data);
      case 'totals':
        return this.totals(data);
      default:
        return ''; // unknown types render nothing rather than raw content
    }
  }

  private itemsTable(
    c: Record<string, unknown>,
    data: Record<string, unknown>,
  ): string {
    const cols = (Array.isArray(c.columns) ? c.columns : []) as Array<{
      key?: string;
      label?: string;
      align?: string;
      width?: number;
    }>;
    const columns = cols.filter((x) => typeof x.key === 'string');
    const rows = Array.isArray(data.items)
      ? (data.items as Array<Record<string, unknown>>)
      : [];
    const width = (x: { width?: number }) =>
      typeof x.width === 'number' && x.width >= 5 && x.width <= 100
        ? ` style="width:${x.width}%"`
        : '';
    const head = columns
      .map(
        (x) =>
          `<th class="${x.align === 'center' ? 'c' : ''}"${width(x)}>${escapeHtml(x.label ?? x.key)}</th>`,
      )
      .join('');
    const body = rows
      .map(
        (r) =>
          `<tr>${columns
            .map(
              (x) =>
                `<td class="${x.align === 'center' ? 'c' : ''}">${escapeHtml(display(r[x.key]))}</td>`,
            )
            .join('')}</tr>`,
      )
      .join('');
    // repeatHeader (default on): the header row is printed again on every page the table spans
    const repeat = c.repeatHeader !== false;
    const cls = `items${c.zebra === true ? ' zebra' : ''}${repeat ? '' : ' norepeat'}`;
    return `<table class="${cls}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  }

  private totals(data: Record<string, unknown>): string {
    const lines = Array.isArray(data.totals)
      ? (data.totals as Array<{
          label?: unknown;
          value?: unknown;
          strong?: unknown;
        }>)
      : [];
    return (
      '<table class="totals"><tbody>' +
      lines
        .map(
          (l) =>
            `<tr class="${l.strong ? 'strong' : ''}"><td>${escapeHtml(l.label)}</td><td class="n">${escapeHtml(display(l.value))}</td></tr>`,
        )
        .join('') +
      '</tbody></table>'
    );
  }

  // ---------------------------------------------------------------- overlay elements

  private qrPayload(
    kind: unknown,
    config: Record<string, unknown> | undefined,
    input: RenderInput,
  ): string | null {
    switch (kind) {
      case 'verification':
        return input.qr?.verificationUrl || null;
      case 'zatca':
        return input.qr?.zatca || null;
      case 'payment':
        return input.qr?.payment || null;
      case 'custom_url': {
        const url = str(config?.url);
        return isSafeHttpsUrl(url) ? url : null;
      }
      default:
        return null;
    }
  }

  private overlayElement(e: RenderElement, input: RenderInput): string {
    const pos = e.position ?? { x: 0, y: 0 };
    const size = e.size ?? { width: 30, height: 30 };
    const style =
      `left:${clamp(num(pos.x, 0), -500, 1500)}mm;top:${clamp(num(pos.y, 0), -500, 3000)}mm;` +
      `width:${clamp(num(size.width, 30), 1, 1000)}mm;height:${clamp(num(size.height, 30), 1, 1000)}mm;` +
      `transform:rotate(${clamp(num(e.rotation, 0), -360, 360)}deg);` +
      `opacity:${clamp(num(e.opacity, 1), 0, 1)};z-index:${Math.trunc(clamp(num(e.zIndex, 1), 0, 1000))}`;

    if (['stamp', 'signature', 'logo', 'image'].includes(e.type)) {
      const src = safeImageUrl(
        e.assetId ? input.assetUrls[e.assetId] : undefined,
      );
      if (!src) return ''; // asset not available to this tenant/user: render nothing
      const cls = e.anchor === 'every' ? 'ov fixed' : 'ov';
      return `<img class="${cls}" style="${style}" src="${escapeHtml(src)}" alt="">`;
    }
    if (e.type === 'qr' || e.type === 'signature_qr') {
      const kind = e.type === 'signature_qr' ? 'verification' : e.config?.kind;
      const payload = this.qrPayload(kind, e.config, input);
      if (!payload) return ''; // content not available yet: draw nothing rather than a wrong code
      const { svg, modules } = qrSvg(payload);
      const side = Math.min(num(size.width, 30), num(size.height, 30));
      if (side < minSideMm(modules)) {
        input.warnings?.push(
          `QR "${e.id ?? ''}" is too small to scan reliably: use at least ${minSideMm(modules)} mm`,
        );
      }
      const cls = e.anchor === 'every' ? 'ov fixed' : 'ov';
      return `<div class="${cls} qr" style="${style}">${svg}</div>`;
    }
    return '';
  }
}

// data-el lets the editor locate each block in the rendered page (click-to-select); harmless in PDF.
function wrapFlow(e: RenderElement, html: string): string {
  const id = typeof e.id === 'string' && /^[\w-]{1,64}$/.test(e.id) ? e.id : '';
  return id ? `<div class="el" data-el="${id}">${html}</div>` : html;
}

const OVERLAY_TYPES = [
  'stamp',
  'signature',
  'signature_qr',
  'logo',
  'image',
  'qr',
];
const isOverlayType = (t: string) => OVERLAY_TYPES.includes(t);

function kv(
  section: string,
  data: Record<string, unknown>,
  lang: 'ar' | 'en',
): string {
  const obj = data[section];
  if (!obj || typeof obj !== 'object') return '';
  const src = obj as Record<string, unknown>;
  // fields and their labels come from the whitelist catalog, never from the data's own keys
  const rows = sectionFields(section)
    .map((b) => ({ k: b.label[lang], v: display(src[b.path.split('.')[1]]) }))
    .filter((r) => r.v !== '')
    .map(
      (r) =>
        `<div class="kv"><span class="k">${escapeHtml(r.k)}</span><span class="v">${escapeHtml(r.v)}</span></div>`,
    )
    .join('');
  return `<div class="block ${section}">${rows}</div>`;
}

function css(w: number, h: number | null, size: string): string {
  return `
@page { size: ${size}; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: 'Cairo','Noto Naskh Arabic','Noto Sans Arabic','Segoe UI',Tahoma,Arial,Helvetica,sans-serif;
  font-size: 12px; color: #0f172a; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { position: relative; width: ${w}mm; ${h ? `min-height: ${h}mm;` : ''} page-break-after: always; }
.page:last-child { page-break-after: auto; }
.flow { position: relative; z-index: 0; }
.ov { position: absolute; object-fit: contain; transform-origin: center; }
.ov.fixed { position: fixed; }
.ov.qr { background: #fff; }
table.frame { width: 100%; border-collapse: collapse; margin: 0; }
table.frame > thead, table.frame > tfoot { display: table-header-group; }
table.frame > tfoot { display: table-footer-group; }
.pagebreak { break-after: page; page-break-after: always; height: 0; }
table.items.zebra tbody tr:nth-child(even) td { background: #f1f5f9; }
table.items.norepeat thead { display: table-row-group; }
h1 { font-size: 20px; margin: 0 0 6px; }
hr { border: 0; border-top: 1px solid #cbd5e1; margin: 8px 0; }
.text { margin: 6px 0; line-height: 1.6; overflow-wrap: anywhere; }
/* mixed Arabic / Latin / numbers: each value orders itself, long values wrap instead of clipping */
.kv .v, table.items td, table.items th, table.totals td { unicode-bidi: plaintext; overflow-wrap: anywhere; }
h1 { overflow-wrap: anywhere; }
.block { margin: 6px 0; }
.kv { display: flex; justify-content: space-between; gap: 8px; padding: 1px 0; }
.kv .k { color: #64748b; }
table { width: 100%; border-collapse: collapse; margin: 6px 0; }
table.items thead { display: table-header-group; }
table.items tr, table.totals tr { page-break-inside: avoid; break-inside: avoid; }
table.totals { break-inside: avoid; }
table.items th { background: #0c447c; color: #fff; padding: 5px 6px; text-align: start; font-weight: 600; }
table.items td { padding: 5px 6px; border-bottom: 1px solid #e2e8f0; }
.c { text-align: center; }
table.totals { width: 45%; margin-inline-start: auto; }
table.totals td { padding: 3px 6px; }
table.totals td.n { text-align: end; font-variant-numeric: tabular-nums; }
table.totals tr.strong td { font-weight: 700; border-top: 1px solid #0c447c; }
`;
}
