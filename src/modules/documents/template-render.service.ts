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
  /** Box / typography options (validated on save; re-checked here before reaching CSS). */
  style?: Record<string, unknown>;
  /** Side-by-side placement of flow blocks. */
  layout?: {
    sideBySide?: boolean;
    width?: number;
    place?: string;
    divider?: boolean;
    /** Free spot in page millimetres: the block leaves the flow. */
    free?: { x: number; y: number; width: number; scale?: number };
  };
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
        const flowAll = mine.filter(
          (e) => e.region !== 'overlay' && !isOverlayType(e.type),
        );
        // blocks dragged to a free spot leave the flow and sit at page millimetres
        const flowEls = flowAll.filter((e) => !freeSpot(e));
        const freeHtml = flowAll
          .filter((e) => freeSpot(e))
          .map((e) => this.freeBlock(e, input))
          .join('');
        // consecutive blocks flagged sideBySide share a row with the block before them
        const groups: RenderElement[][] = [];
        for (const e of flowEls) {
          if (e.layout?.sideBySide === true && groups.length > 0) {
            groups[groups.length - 1].push(e);
          } else {
            groups.push([e]);
          }
        }
        const flow = groups.map((g) => this.flowGroup(g, input)).join('');
        const overlay = freeHtml + (input.omitOverlays
          ? ''
          : mine
              .filter((e) => e.region === 'overlay' || isOverlayType(e.type))
              .sort((a, b) => num(a.zIndex, 0) - num(b.zIndex, 0))
              .map((e) => this.overlayElement(e, input))
              .join(''));
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

  private freeBlock(e: RenderElement, input: RenderInput): string {
    const f = freeSpot(e);
    if (!f) return '';
    return (
      '<div class="free" style="left:' + f.x + 'mm;top:' + f.y + 'mm;width:' + f.width + 'mm' + (f.scale !== 1 ? ';transform:scale(' + f.scale + ');transform-origin:top left' : '') + '">' +
      wrapFlow(e, this.flowElement(e, input), false) +
      '</div>'
    );
  }

  private flowGroup(g: RenderElement[], input: RenderInput): string {
    const first = g[0];
    const plain =
      g.length === 1 &&
      first.layout?.width === undefined &&
      !first.layout?.place;
    if (plain) return wrapFlow(first, this.flowElement(first, input));
    const equal = 100 / g.length;
    const gapShare = ((g.length - 1) * 4) / g.length;
    const cols = g
      .map((e) => {
        const w = clamp(num(e.layout?.width, equal), 5, 100);
        const basis =
          g.length === 1 ? w + '%' : 'calc(' + w + '% - ' + gapShare + 'mm)';
        return (
          '<div class="col' +
          (e.layout?.divider ? ' div' : '') +
          '" style="flex:0 0 ' +
          basis +
          '">' +
          wrapFlow(e, this.flowElement(e, input), false) +
          '</div>'
        );
      })
      .join('');
    const place = first.layout?.place;
    const justify =
      place === 'center'
        ? 'center'
        : place === 'end'
          ? 'flex-end'
          : 'flex-start';
    const gap = marginTop(first.style);
    // cards stretch to equal height, except rows that hold a table or the totals
    const top = g.some((e) => e.type === 'totals' || e.type === 'items_table')
      ? ';align-items:flex-start'
      : '';
    return (
      '<div class="row" style="justify-content:' +
      justify +
      (gap ? ';' + gap : '') +
      top +
      '">' +
      cols +
      '</div>'
    );
  }

  private flowElement(e: RenderElement, input: RenderInput): string {
    const c = e.config ?? {};
    const data = input.data;
    const missing = input.body.missingValue === 'dash' ? '—' : '';
    const lang = input.direction === 'rtl' ? 'ar' : 'en';
    switch (e.type) {
      case 'heading':
        return `<h1>${interpolate(str(c.text), data, missing).replace(/\n/g, '<br>')}</h1>`;
      case 'terms':
        return this.terms(c, data, missing);
      case 'text':
      case 'footer':
        return `<div class="text ${e.type}">${interpolate(str(c.text), data, missing).replace(/\n/g, '<br>')}</div>`;
      case 'divider':
        return '<hr>';
      case 'page_break':
        return '<div class="pagebreak"></div>';
      case 'company_info':
        return kv('company', data, lang, c);
      case 'customer_info':
        return kv('customer', data, lang, c);
      case 'document_info':
        return kv('document', data, lang, c);
      case 'payment_details':
        return kv('payment', data, lang, c);
      case 'items_table':
        return this.itemsTable(c, data, lang);
      case 'totals':
        return this.totals(data, c, lang);
      default:
        return ''; // unknown types render nothing rather than raw content
    }
  }

  private terms(
    c: Record<string, unknown>,
    data: Record<string, unknown>,
    missing: string,
  ): string {
    const text = interpolate(str(c.text), data, missing);
    const titleBg = hexOk(c.titleBg);
    const bullet = hexOk(c.bulletColor);
    const title = str(c.title);
    // plain terms (no title / bullet colour set) keep the original rendering
    if (!title && !bullet && !titleBg) {
      return (
        '<div class="text terms">' + text.replace(/\n/g, '<br>') + '</div>'
      );
    }
    const head = title
      ? '<div class="th"' +
        (titleBg ? ' style="background:' + titleBg + '"' : '') +
        '>' +
        icon('doc') +
        escapeHtml(title) +
        '</div>'
      : '';
    const items = text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => '<li>' + l.replace(/^(•|-|\*)\s*/, '') + '</li>')
      .join('');
    return (
      '<div class="terms2"' +
      (bullet ? ' style="--bullet:' + bullet + '"' : '') +
      '>' +
      head +
      '<ul class="bl">' +
      items +
      '</ul></div>'
    );
  }

  private itemsTable(
    c: Record<string, unknown>,
    data: Record<string, unknown>,
    lang: 'ar' | 'en',
  ): string {
    const cur = c.showCurrency === true ? currencyLabel(lang) : '';
    const headBg = hexOk(c.headerBg);
    const cols = (Array.isArray(c.columns) ? c.columns : []) as Array<{
      key?: string;
      label?: string;
      align?: string;
      width?: number;
      bold?: boolean;
    }>;
    const columns = cols.filter((x) => typeof x.key === 'string');
    const rows = Array.isArray(data.items)
      ? (data.items as Array<Record<string, unknown>>)
      : [];
    const thStyle = (x: { width?: number }) => {
      const parts: string[] = [];
      if (typeof x.width === 'number' && x.width >= 5 && x.width <= 100)
        parts.push('width:' + x.width + '%');
      if (headBg) parts.push('background:' + headBg);
      return parts.length ? ' style="' + parts.join(';') + '"' : '';
    };
    const head = columns
      .map(
        (x) =>
          `<th class="${x.align === 'center' ? 'c' : ''}"${thStyle(x)}>${escapeHtml(x.label ?? x.key)}</th>`,
      )
      .join('');
    const cell = (r: Record<string, unknown>, i: number, key: string) => {
      if (key === 'index') return String(i + 1);
      const v = display(r[key]);
      return cur && v !== '' && MONEY_COLUMNS.has(key) ? v + ' ' + cur : v;
    };
    const body = rows
      .map(
        (r, i) =>
          `<tr>${columns
            .map(
              (x) =>
                `<td class="${x.align === 'center' ? 'c' : ''}${x.bold ? ' b' : ''}">${escapeHtml(cell(r, i, x.key ?? ''))}</td>`,
            )
            .join('')}</tr>`,
      )
      .join('');
    // repeatHeader (default on): the header row is printed again on every page the table spans
    const repeat = c.repeatHeader !== false;
    const cls = `items${c.zebra === true ? ' zebra' : ''}${repeat ? '' : ' norepeat'}${c.grid === true ? ' grid' : ''}`;
    return `<table class="${cls}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  }

  private totals(
    data: Record<string, unknown>,
    c: Record<string, unknown>,
    lang: 'ar' | 'en',
  ): string {
    const cur = c.showCurrency === true ? currencyLabel(lang) : '';
    const accent = hexOk(c.accent);
    const accentValue = hexOk(c.accentValue) ?? accent;
    const labelBg = hexOk(c.labelBg);
    const vars = [
      accent ? '--accent:' + accent : '',
      accentValue ? '--accent2:' + accentValue : '',
      labelBg ? '--lbl:' + labelBg : '',
    ]
      .filter(Boolean)
      .join(';');
    const lines = Array.isArray(data.totals)
      ? (data.totals as Array<{
          label?: unknown;
          value?: unknown;
          strong?: unknown;
        }>)
      : [];
    return (
      '<table class="totals' +
      (accent ? ' accent' : '') +
      '"' +
      (vars ? ' style="' + vars + '"' : '') +
      '><tbody>' +
      lines
        .map(
          (l) =>
            `<tr class="${l.strong ? 'strong' : ''}"><td>${escapeHtml(l.label)}</td><td class="n">${escapeHtml(display(l.value) !== '' && cur ? display(l.value) + ' ' + cur : display(l.value))}</td></tr>`,
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
      `width:${clamp(num(size.width, 30), 0.2, 1000)}mm;height:${clamp(num(size.height, 30), 0.2, 1000)}mm;` +
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
    if (e.type === 'text_box') {
      const missing = input.body.missingValue === 'dash' ? '—' : '';
      const text = interpolate(
        str(e.config?.text),
        input.data,
        missing,
      ).replace(/\n/g, '<br>');
      const cls = e.anchor === 'every' ? 'ov fixed tb' : 'ov tb';
      return (
        '<div class="' +
        cls +
        '" style="' +
        style +
        ';' +
        styleCss(e.style) +
        '">' +
        text +
        '</div>'
      );
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
function marginTop(style: unknown): string {
  const v =
    style && typeof style === 'object'
      ? (style as Record<string, unknown>).spaceBefore
      : undefined;
  return typeof v === 'number' ? 'margin-top:' + clamp(v, 0, 60) + 'mm' : '';
}

function freeSpot(
  e: RenderElement,
): { x: number; y: number; width: number; scale: number } | null {
  const f = e.layout?.free;
  if (!f || typeof f !== 'object') return null;
  return {
    x: clamp(num(f.x, 0), -100, 1000),
    y: clamp(num(f.y, 0), -100, 3000),
    width: clamp(num(f.width, 100), 5, 1000),
    scale: clamp(num(f.scale, 1), 0.2, 5),
  };
}

function wrapFlow(e: RenderElement, html: string, withMargin = true): string {
  const id = typeof e.id === 'string' && /^[\w-]{1,64}$/.test(e.id) ? e.id : '';
  const css = [styleCss(e.style), withMargin ? marginTop(e.style) : '']
    .filter(Boolean)
    .join(';');
  const fs = e.style && typeof e.style.fontSize === 'number' ? ' fs' : '';
  if (!id && !css) return html;
  return (
    '<div class="el' +
    fs +
    '"' +
    (id ? ' data-el="' + id + '"' : '') +
    (css ? ' style="' + css + '"' : '') +
    '>' +
    html +
    '</div>'
  );
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const hexOk = (v: unknown): string | null =>
  typeof v === 'string' && HEX_RE.test(v) ? v : null;

const MONEY_COLUMNS = new Set(['unit_price', 'discount', 'tax', 'total']);
const currencyLabel = (lang: 'ar' | 'en') => (lang === 'ar' ? 'ر.س' : 'SAR');

/** Whitelisted CSS from validated style options; anything unexpected is dropped. */
function styleCss(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return '';
  const s = raw as Record<string, unknown>;
  const out: string[] = [];
  const bg = hexOk(s.bg);
  if (bg) out.push('background:' + bg);
  const color = hexOk(s.color);
  if (color) out.push('color:' + color);
  const border = hexOk(s.border);
  if (border)
    out.push(
      'border:' + clamp(num(s.borderWidth, 0.3), 0, 2) + 'mm solid ' + border,
    );
  if (typeof s.radius === 'number')
    out.push('border-radius:' + clamp(s.radius, 0, 30) + 'mm;overflow:hidden');
  if (typeof s.padding === 'number')
    out.push('padding:' + clamp(s.padding, 0, 30) + 'mm');
  if (typeof s.fontSize === 'number')
    out.push('font-size:' + clamp(s.fontSize, 6, 72) + 'pt');
  if (['start', 'center', 'end'].includes(s.align as string))
    out.push('text-align:' + (s.align as string));
  if (s.weight === 'bold') out.push('font-weight:700');
  return out.join(';');
}

const ICON_PATHS: Record<string, string> = {
  phone:
    'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z',
  mail: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z M22 6l-10 7L2 6',
  pin: 'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  user: 'M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  doc: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z M14 2v6h6 M8 13h8 M8 17h8',
  calendar:
    'M8 2v4 M16 2v4 M3 10h18 M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z',
  calendar_check:
    'M8 2v4 M16 2v4 M3 10h18 M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z M9 16l2 2 4-4',
  hash: 'M4 9h16 M4 15h16 M10 3 8 21 M16 3l-2 18',
  card: 'M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z M2 10h20',
};
const FIELD_ICON: Record<string, string> = {
  phone: 'phone',
  email: 'mail',
  address: 'pin',
  name: 'user',
  number: 'doc',
  date: 'calendar',
  valid_until: 'calendar_check',
  due_date: 'calendar',
  vat_number: 'hash',
  cr_number: 'hash',
  reference: 'doc',
  notes: 'doc',
  method: 'card',
  bank_name: 'card',
  iban: 'card',
};
const icon = (field: string): string => {
  const d = ICON_PATHS[FIELD_ICON[field] ?? 'doc'];
  return (
    '<svg class="ic" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' +
    d +
    '"/></svg>'
  );
};

const OVERLAY_TYPES = [
  'text_box',
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
  c: Record<string, unknown> = {},
): string {
  const obj = data[section];
  if (!obj || typeof obj !== 'object') return '';
  const src = obj as Record<string, unknown>;
  // fields and their labels come from the whitelist catalog, never from the data's own keys
  const all = sectionFields(section);
  const chosen = Array.isArray(c.fields)
    ? (c.fields as unknown[])
        .map((k) => all.find((b) => b.path.split('.')[1] === k))
        .filter((b): b is (typeof all)[number] => !!b)
    : all;
  const mode =
    c.labelMode === 'inline' || c.labelMode === 'none' ? c.labelMode : 'split';
  const withIcons = c.icons === true;
  const rowBg = hexOk(c.rowBg);
  const rows = chosen
    .map((b) => {
      const field = b.path.split('.')[1];
      return { field, k: b.label[lang], v: display(src[field]) };
    })
    .filter((r) => r.v !== '')
    .map((r) => {
      const ic = withIcons ? icon(r.field) : '';
      const label =
        mode === 'none'
          ? ic
          : '<span class="kl">' +
            ic +
            '<span class="k">' +
            escapeHtml(r.k) +
            (mode === 'inline' ? ':' : '') +
            '</span></span>';
      const value = '<span class="v">' + escapeHtml(r.v) + '</span>';
      return '<div class="kv ' + mode + '">' + label + value + '</div>';
    })
    .join('');
  return (
    '<div class="block ' +
    section +
    (rowBg ? ' band' : '') +
    '"' +
    (rowBg ? ' style="--row:' + rowBg + '"' : '') +
    '>' +
    rows +
    '</div>'
  );
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
.free { position: absolute; z-index: 1; }
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
/* plaintext cells take their direction from the text, so an English value would sit on the LEFT of an Arabic page: pin every cell to the start side of the document instead (zero specificity so .c / .n / column alignment still win) */
:where(html[dir=rtl]) :where(.kv .v, table.items td, table.items th, table.totals td) { text-align: right; }
:where(html[dir=ltr]) :where(.kv .v, table.items td, table.items th, table.totals td) { text-align: left; }
h1 { overflow-wrap: anywhere; }
.block { margin: 6px 0; }
.kv { display: flex; justify-content: space-between; gap: 8px; padding: 1px 0; }
.kv .k { color: #64748b; }
table { width: 100%; border-collapse: collapse; margin: 6px 0; }
table.items thead { display: table-header-group; }
table.items tr, table.totals tr { page-break-inside: avoid; break-inside: avoid; }
table.totals { break-inside: avoid; }
table.items th { background: #0c447c; color: #fff; padding: 5px 6px; font-weight: 600; }
table.items td { padding: 5px 6px; border-bottom: 1px solid #e2e8f0; }
.c { text-align: center; }
table.totals { width: 45%; margin-inline-start: auto; }
table.totals td { padding: 3px 6px; }
table.totals td.n { text-align: end; font-variant-numeric: tabular-nums; }
table.totals tr.strong td { font-weight: 700; border-top: 1px solid #0c447c; }
table.totals.accent tr.strong td { background: var(--accent); color: #fff; border-top: 0; }
.row { display: flex; gap: 4mm; align-items: stretch; break-inside: avoid; }
.col { min-width: 0; display: flex; }
.col > .el { flex: 1; min-width: 0; }
.col > .block, .col > .text, .col > h1 { flex: 1; min-width: 0; }
.col table.totals, .free table.totals { width: 100%; margin: 0; }
.el.fs * { font-size: inherit; }
.el h1 { margin: 0; }
.ic { color: #0c447c; flex: none; margin-inline-end: 6px; vertical-align: middle; }
.kv .kl { display: inline-flex; align-items: center; }
.kv.inline, .kv.none { justify-content: flex-start; gap: 4px; }
.ov.tb { overflow-wrap: anywhere; line-height: 1.5; object-fit: initial; }
.block.band .kv { background: var(--row); border-radius: 2mm; padding: 1.2mm 3mm; margin: 1mm 0; }
.col.div { border-inline-start: 0.3mm solid #cbd5e1; padding-inline-start: 4mm; }
.col.div:first-child { border: 0; padding: 0; }
table.items.grid td, table.items.grid th { border-inline-start: 1px solid #d5e2ef; }
table.items.grid td:first-child, table.items.grid th:first-child { border-inline-start: 0; }
table.items td.b { font-weight: 700; }
table.totals td:first-child { background: var(--lbl, transparent); }
table.totals tr.strong td { font-size: 1.15em; }
table.totals.accent tr.strong td:first-child { background: var(--accent); }
table.totals.accent tr.strong td:last-child { background: var(--accent2, var(--accent)); }
table.totals td { border-bottom: 1px solid #e2e8f0; }
.terms2 .th { display: flex; align-items: center; gap: 6px; background: #0c447c; color: #fff; font-weight: 700; padding: 2mm 4mm; border-radius: 6mm; margin-bottom: 2mm; }
.terms2 .th .ic { color: #fff; margin: 0; }
.terms2 ul.bl { list-style: none; margin: 0; padding: 0; }
.terms2 li { position: relative; padding-inline-start: 5mm; margin: 1mm 0; line-height: 1.5; overflow-wrap: anywhere; }
.terms2 li::before { content: ''; position: absolute; inset-inline-start: 0; top: 0.65em; width: 2mm; height: 2mm; border-radius: 50%; background: var(--bullet, #14b8a6); }
`;
}
