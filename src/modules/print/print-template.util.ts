import { BadRequestException } from '@nestjs/common';
import {
  INVOICE_BLOCK_KEYS,
  InvoiceTemplate,
  KITCHEN_BLOCK_KEYS,
  KITCHEN_FONT_SIZES,
  KitchenTemplate,
  PAPER_WIDTHS,
  PaperWidth,
  TemplateBlock,
  TemplateKind,
} from './print.types';

const MAX_TEXT = 500;
const MAX_COPIES = 5;

export function defaultInvoiceTemplate(): InvoiceTemplate {
  return {
    logo_path: null,
    logo_url: null,
    show_logo: true,
    business_name: null,
    address: null,
    phone: null,
    tax_number: null,
    commercial_register: null,
    footer: null,
    paper_width: '80mm',
    blocks: INVOICE_BLOCK_KEYS.map((key) => ({
      key,
      visible: key !== 'worker',
    })),
    qr_enabled: false,
    copies: 1,
  };
}

export function defaultKitchenTemplate(): KitchenTemplate {
  return {
    header_text: null,
    paper_width: '80mm',
    font_size: 'md',
    blocks: KITCHEN_BLOCK_KEYS.map((key) => ({
      key,
      visible: key !== 'cashier',
    })),
    show_item_notes: true,
    copies: 1,
  };
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function text(v: unknown, field: string, strict: boolean): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') {
    if (strict) throw new BadRequestException(`${field} must be a string`);
    return null;
  }
  const t = v.trim();
  if (t.length > MAX_TEXT) {
    if (strict) throw new BadRequestException(`${field} is too long`);
    return t.slice(0, MAX_TEXT);
  }
  return t === '' ? null : t;
}

function bool(v: unknown, field: string, fallback: boolean, strict: boolean) {
  if (v === undefined || v === null) return fallback;
  if (typeof v !== 'boolean') {
    if (strict) throw new BadRequestException(`${field} must be a boolean`);
    return fallback;
  }
  return v;
}

function paper(v: unknown, fallback: PaperWidth, strict: boolean): PaperWidth {
  if (v === undefined || v === null) return fallback;
  if (!PAPER_WIDTHS.includes(v as PaperWidth)) {
    if (strict) {
      throw new BadRequestException(
        `paper_width must be one of ${PAPER_WIDTHS.join(', ')}`,
      );
    }
    return fallback;
  }
  return v as PaperWidth;
}

function copies(v: unknown, fallback: number, strict: boolean): number {
  if (v === undefined || v === null) return fallback;
  if (
    typeof v !== 'number' ||
    !Number.isInteger(v) ||
    v < 1 ||
    v > MAX_COPIES
  ) {
    if (strict) {
      throw new BadRequestException(
        `copies must be an integer 1..${MAX_COPIES}`,
      );
    }
    return fallback;
  }
  return v;
}

/**
 * Blocks keep the order the caller gave; unknown/duplicate keys are dropped
 * (or rejected when strict) and any known block that was not mentioned is
 * appended with its default visibility, so a template stored before a block
 * existed still renders it.
 */
function blocks(
  v: unknown,
  allowed: readonly string[],
  defaults: TemplateBlock[],
  strict: boolean,
): TemplateBlock[] {
  if (v === undefined || v === null) return defaults.map((b) => ({ ...b }));
  if (!Array.isArray(v)) {
    if (strict) throw new BadRequestException('blocks must be an array');
    return defaults.map((b) => ({ ...b }));
  }
  const seen = new Set<string>();
  const out: TemplateBlock[] = [];
  for (const raw of v) {
    if (
      !isObj(raw) ||
      typeof raw.key !== 'string' ||
      !allowed.includes(raw.key)
    ) {
      if (strict)
        throw new BadRequestException('blocks contains an unknown block');
      continue;
    }
    if (seen.has(raw.key)) {
      if (strict) throw new BadRequestException(`duplicate block ${raw.key}`);
      continue;
    }
    seen.add(raw.key);
    out.push({ key: raw.key, visible: raw.visible !== false });
  }
  for (const d of defaults) if (!seen.has(d.key)) out.push({ ...d });
  return out;
}

function logoUrl(v: unknown, strict: boolean): string | null {
  const t = text(v, 'logo_url', strict);
  if (t === null) return null;
  if (!/^https?:\/\//i.test(t)) {
    if (strict)
      throw new BadRequestException('logo_url must be an http(s) URL');
    return null;
  }
  return t;
}

/** strict=true (PATCH) throws on bad input; strict=false (read) repairs it. */
export function normalizeInvoiceTemplate(
  raw: unknown,
  strict = false,
): InvoiceTemplate {
  const d = defaultInvoiceTemplate();
  if (!isObj(raw)) {
    if (strict && raw !== undefined && raw !== null) {
      throw new BadRequestException('template must be an object');
    }
    return d;
  }
  return {
    logo_path: text(raw.logo_path, 'logo_path', strict),
    logo_url: logoUrl(raw.logo_url, strict),
    show_logo: bool(raw.show_logo, 'show_logo', d.show_logo, strict),
    business_name: text(raw.business_name, 'business_name', strict),
    address: text(raw.address, 'address', strict),
    phone: text(raw.phone, 'phone', strict),
    tax_number: text(raw.tax_number, 'tax_number', strict),
    commercial_register: text(
      raw.commercial_register,
      'commercial_register',
      strict,
    ),
    footer: text(raw.footer, 'footer', strict),
    paper_width: paper(raw.paper_width, d.paper_width, strict),
    blocks: blocks(raw.blocks, INVOICE_BLOCK_KEYS, d.blocks, strict),
    qr_enabled: bool(raw.qr_enabled, 'qr_enabled', false, strict),
    copies: copies(raw.copies, d.copies, strict),
  };
}

export function normalizeKitchenTemplate(
  raw: unknown,
  strict = false,
): KitchenTemplate {
  const d = defaultKitchenTemplate();
  if (!isObj(raw)) {
    if (strict && raw !== undefined && raw !== null) {
      throw new BadRequestException('template must be an object');
    }
    return d;
  }
  let font = d.font_size;
  if (raw.font_size !== undefined && raw.font_size !== null) {
    if ((KITCHEN_FONT_SIZES as readonly unknown[]).includes(raw.font_size)) {
      font = raw.font_size as KitchenTemplate['font_size'];
    } else if (strict) {
      throw new BadRequestException(
        `font_size must be one of ${KITCHEN_FONT_SIZES.join(', ')}`,
      );
    }
  }
  return {
    header_text: text(raw.header_text, 'header_text', strict),
    paper_width: paper(raw.paper_width, d.paper_width, strict),
    font_size: font,
    blocks: blocks(raw.blocks, KITCHEN_BLOCK_KEYS, d.blocks, strict),
    show_item_notes: bool(raw.show_item_notes, 'show_item_notes', true, strict),
    copies: copies(raw.copies, d.copies, strict),
  };
}

export function normalizeTemplate(
  kind: TemplateKind,
  raw: unknown,
  strict = false,
): InvoiceTemplate | KitchenTemplate {
  return kind === 'invoice'
    ? normalizeInvoiceTemplate(raw, strict)
    : normalizeKitchenTemplate(raw, strict);
}

const isEmptyObj = (v: unknown) => isObj(v) && Object.keys(v).length === 0;

/**
 * Branch override wins when set (non-null, non-empty). It REPLACES the tenant
 * template as a whole (it is a complete template saved from the same designer)
 * rather than merging field by field; empty business fields in it still fall
 * back to the tenant columns when the payload is built.
 */
export function resolveTemplate(
  kind: TemplateKind,
  tenantTemplate: unknown,
  branchTemplate: unknown,
  legacyPaperWidth?: unknown,
) {
  const useBranch = isObj(branchTemplate) && !isEmptyObj(branchTemplate);
  const raw = useBranch ? branchTemplate : tenantTemplate;
  const template = normalizeTemplate(kind, raw);
  // Until the owner saves a template, the paper width the owner already chose
  // in Settings > Printer (tenants.printer_settings.paper_width) still applies.
  const hasOwnPaper =
    isObj(raw) && PAPER_WIDTHS.includes(raw.paper_width as PaperWidth);
  if (!hasOwnPaper && PAPER_WIDTHS.includes(legacyPaperWidth as PaperWidth)) {
    template.paper_width = legacyPaperWidth as PaperWidth;
  }
  return {
    template,
    source: useBranch ? 'branch' : 'tenant',
  };
}
