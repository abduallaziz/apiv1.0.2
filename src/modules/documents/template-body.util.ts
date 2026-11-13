import { BadRequestException } from '@nestjs/common';
import {
  QR_KINDS,
  isSafeHttpsUrl,
  qrGeometryProblem,
  type QrKind,
} from './qr.util';
import {
  BINDING_PATHS,
  ITEM_COLUMN_KEYS,
  bindingsInText,
} from './bindings.catalog';

// Strict, whitelist-based validation of a template body (design A4: validated JSON, no code).
// Returns a SANITIZED copy: only known keys survive, so nothing unexpected is ever stored or
// rendered. Ownership of referenced assets is checked separately (needs the database).

export const FLOW_TYPES = [
  'heading',
  'text',
  'terms',
  'footer',
  'divider',
  'company_info',
  'customer_info',
  'document_info',
  'payment_details',
  'items_table',
  'totals',
  'page_break',
] as const;
export const OVERLAY_TYPES = [
  'stamp',
  'signature',
  'logo',
  'image',
  'qr',
  'signature_qr',
] as const;

const PAPERS = ['A4', 'A5', '80mm', '58mm'];
const ORIENTATIONS = ['portrait', 'landscape'];
const ALIGNS = ['start', 'center'];
const ID_RE = /^[\w-]{1,64}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const MAX_ELEMENTS = 300;
const MAX_PAGES = 10;
const MAX_COLUMNS = 12;
const MAX_TEXT = 5000;

type Obj = Record<string, unknown>;

const fail = (msg: string): never => {
  throw new BadRequestException(`Invalid template body: ${msg}`);
};

const isObj = (v: unknown): v is Obj =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function num(v: unknown, name: string, lo: number, hi: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) {
    fail(`${name} must be a number between ${lo} and ${hi}`);
  }
  return v as number;
}

function bool(v: unknown, name: string): boolean {
  if (typeof v !== 'boolean') fail(`${name} must be a boolean`);
  return v as boolean;
}

function str(v: unknown, name: string, max: number): string {
  if (typeof v !== 'string' || v.length > max) {
    fail(`${name} must be a string up to ${max} characters`);
  }
  return v as string;
}

function sanitizeConfig(type: string, raw: unknown): Obj | undefined {
  if (raw === undefined) return undefined;
  if (!isObj(raw)) return fail('config must be an object');
  const cfg = raw;
  const out: Obj = {};
  if (cfg.text !== undefined) {
    const text = str(cfg.text, 'config.text', MAX_TEXT);
    for (const b of bindingsInText(text)) {
      if (!BINDING_PATHS.has(b)) fail(`unknown binding "{{${b}}}"`);
    }
    out.text = text;
  }
  if (type === 'qr' || type === 'signature_qr') {
    // signature_qr is always the verification QR; a free-form kind is only for plain 'qr'
    const kind = type === 'signature_qr' ? 'verification' : cfg.kind;
    if (!(QR_KINDS as readonly string[]).includes(kind as string)) {
      fail(`qr kind must be one of ${QR_KINDS.join(', ')}`);
    }
    out.kind = kind;
    if (kind === 'custom_url') {
      const url = str(cfg.url, 'config.url', 500);
      if (!isSafeHttpsUrl(url)) fail('custom QR url must be a valid https URL');
      out.url = url;
    }
  }
  if (type === 'items_table' && cfg.columns !== undefined) {
    if (!Array.isArray(cfg.columns) || cfg.columns.length > MAX_COLUMNS) {
      fail(`columns must be an array of at most ${MAX_COLUMNS}`);
    }
    out.columns = (cfg.columns as unknown[]).map((c) => {
      if (!isObj(c)) return fail('column must be an object');
      const col = c;
      const key = str(col.key, 'column.key', 40);
      if (!ITEM_COLUMN_KEYS.has(key)) fail(`unknown column "${key}"`);
      const column: Obj = {
        key,
        label: str(col.label ?? '', 'column.label', 80),
      };
      if (col.width !== undefined) {
        column.width = num(col.width, 'column.width', 5, 100);
      }
      if (col.align !== undefined) {
        if (!ALIGNS.includes(col.align as string)) fail('column.align invalid');
        column.align = col.align;
      }
      return column;
    });
  }
  if (type === 'items_table') {
    if (cfg.repeatHeader !== undefined)
      out.repeatHeader = bool(cfg.repeatHeader, 'config.repeatHeader');
    if (cfg.zebra !== undefined) out.zebra = bool(cfg.zebra, 'config.zebra');
  }
  return out;
}

function sanitizeElement(raw: unknown, idx: number): Obj {
  if (!isObj(raw)) return fail(`elements[${idx}] must be an object`);
  const e = raw;
  const id = str(e.id, 'element.id', 64);
  if (!ID_RE.test(id)) fail('element.id has invalid characters');
  const type = e.type as string;
  const isFlow = (FLOW_TYPES as readonly string[]).includes(type);
  const isOverlay = (OVERLAY_TYPES as readonly string[]).includes(type);
  if (!isFlow && !isOverlay) fail(`unknown element type "${String(type)}"`);

  const out: Obj = { id, type, region: isOverlay ? 'overlay' : 'flow' };
  out.page = e.page === undefined ? 0 : num(e.page, 'page', 0, MAX_PAGES - 1);
  if (!Number.isInteger(out.page)) fail('page must be an integer');
  const config = sanitizeConfig(type, e.config);
  if (config) out.config = config;
  if (e.visible !== undefined) out.visible = bool(e.visible, 'visible');

  if (isOverlay) {
    if (e.assetId !== undefined) {
      const a = str(e.assetId, 'assetId', 36);
      if (!UUID_RE.test(a)) fail('assetId must be a UUID');
      out.assetId = a;
    } else if (['stamp', 'signature', 'logo', 'image'].includes(type)) {
      fail(`${type} requires an assetId`);
    }
    if (e.position !== undefined) {
      if (!isObj(e.position)) fail('position must be an object');
      const p = e.position as Obj;
      out.position = {
        x: num(p.x, 'position.x', -500, 1500),
        y: num(p.y, 'position.y', -500, 3000),
      };
    }
    if (e.size !== undefined) {
      if (!isObj(e.size)) fail('size must be an object');
      const s = e.size as Obj;
      out.size = {
        width: num(s.width, 'size.width', 1, 1000),
        height: num(s.height, 'size.height', 1, 1000),
      };
    }
    if (e.rotation !== undefined)
      out.rotation = num(e.rotation, 'rotation', -360, 360);
    if (e.opacity !== undefined) out.opacity = num(e.opacity, 'opacity', 0, 1);
    if (e.zIndex !== undefined) {
      out.zIndex = num(e.zIndex, 'zIndex', 0, 1000);
      if (!Number.isInteger(out.zIndex)) fail('zIndex must be an integer');
    }
    if (type === 'qr' || type === 'signature_qr') {
      if (out.size === undefined) fail('a QR code requires a size');
      const cfg = (out.config ?? {}) as Obj;
      const problem = qrGeometryProblem(
        cfg.kind as QrKind,
        out.size as { width: number; height: number },
        out.opacity as number | undefined,
        cfg.url as string | undefined,
      );
      if (problem) fail(problem);
    }
    if (e.anchor !== undefined) {
      if (!['first', 'every'].includes(e.anchor as string))
        fail('anchor must be "first" or "every"');
      out.anchor = e.anchor;
    }
    if (e.locked !== undefined) out.locked = bool(e.locked, 'locked');
    if (e.maintainAspect !== undefined)
      out.maintainAspect = bool(e.maintainAspect, 'maintainAspect');
  }
  return out;
}

export function sanitizeBody(raw: unknown): Obj {
  if (!isObj(raw)) return fail('body must be an object');
  const body = raw;

  const pagesRaw = body.pages ?? [{}];
  if (
    !Array.isArray(pagesRaw) ||
    pagesRaw.length < 1 ||
    pagesRaw.length > MAX_PAGES
  ) {
    fail(`pages must be an array of 1-${MAX_PAGES}`);
  }
  const pages = (pagesRaw as unknown[]).map((p) => {
    if (!isObj(p)) return fail('page must be an object');
    const pg = p;
    const out: Obj = {};
    if (pg.size !== undefined) {
      if (!PAPERS.includes(pg.size as string)) fail('page.size invalid');
      out.size = pg.size;
    }
    if (pg.orientation !== undefined) {
      if (!ORIENTATIONS.includes(pg.orientation as string))
        fail('page.orientation invalid');
      out.orientation = pg.orientation;
    }
    if (pg.marginsMm !== undefined) {
      if (!isObj(pg.marginsMm)) fail('marginsMm must be an object');
      const m = pg.marginsMm as Obj;
      out.marginsMm = {
        top: num(m.top ?? 10, 'margin.top', 0, 60),
        right: num(m.right ?? 10, 'margin.right', 0, 60),
        bottom: num(m.bottom ?? 10, 'margin.bottom', 0, 60),
        left: num(m.left ?? 10, 'margin.left', 0, 60),
      };
    }
    return out;
  });

  const elsRaw = body.elements ?? [];
  if (!Array.isArray(elsRaw) || elsRaw.length > MAX_ELEMENTS) {
    fail(`elements must be an array of at most ${MAX_ELEMENTS}`);
  }
  const elements = (elsRaw as unknown[]).map(sanitizeElement);
  const ids = new Set<string>();
  for (const e of elements) {
    const id = e.id as string;
    if (ids.has(id)) fail(`duplicate element id "${id}"`);
    ids.add(id);
    if ((e.page as number) >= pages.length)
      fail('element refers to a missing page');
  }

  const out: Obj = { pages, elements };
  if (body.missingValue !== undefined) {
    if (!['blank', 'dash'].includes(body.missingValue as string))
      fail('missingValue must be "blank" or "dash"');
    out.missingValue = body.missingValue;
  }
  // the stored list is DERIVED from the texts, never trusted from the client
  out.bindings = [
    ...new Set(
      elements.flatMap((e) =>
        bindingsInText(((e.config as Obj | undefined)?.text as string) ?? ''),
      ),
    ),
  ];
  return out;
}

/** Asset ids referenced by overlay elements (unique). */
export function referencedAssetIds(body: Obj): string[] {
  const els = (body.elements as Obj[] | undefined) ?? [];
  return [
    ...new Set(
      els
        .map((e) => e.assetId)
        .filter((a): a is string => typeof a === 'string'),
    ),
  ];
}
