import { BadRequestException } from '@nestjs/common';
import {
  defaultInvoiceTemplate,
  defaultKitchenTemplate,
  normalizeInvoiceTemplate,
  normalizeKitchenTemplate,
  resolveTemplate,
} from './print-template.util';

describe('template defaults', () => {
  it('an empty object equals the default look (QR off, 80mm, 1 copy)', () => {
    expect(normalizeInvoiceTemplate({})).toEqual(defaultInvoiceTemplate());
    expect(normalizeKitchenTemplate({})).toEqual(defaultKitchenTemplate());
    expect(defaultInvoiceTemplate().qr_enabled).toBe(false);
    expect(defaultInvoiceTemplate().tax_number).toBeNull();
  });
});

describe('normalizeInvoiceTemplate', () => {
  it('keeps block order, appends missing blocks, drops unknown ones (lenient)', () => {
    const t = normalizeInvoiceTemplate({
      blocks: [
        { key: 'notes', visible: true },
        { key: 'bogus', visible: true },
        { key: 'cashier', visible: false },
        { key: 'notes', visible: false },
      ],
    });
    expect(t.blocks.map((b) => b.key).slice(0, 2)).toEqual([
      'notes',
      'cashier',
    ]);
    expect(t.blocks.find((b) => b.key === 'cashier')?.visible).toBe(false);
    expect(t.blocks).toHaveLength(6);
  });

  it('strict mode rejects bad shapes', () => {
    const bad = (v: object) => () => normalizeInvoiceTemplate(v, true);
    expect(bad({ paper_width: '100mm' })).toThrow(BadRequestException);
    expect(bad({ copies: 99 })).toThrow(BadRequestException);
    expect(bad({ blocks: [{ key: 'x' }] })).toThrow(BadRequestException);
    expect(bad({ logo_url: 'javascript:alert(1)' })).toThrow(
      BadRequestException,
    );
    expect(bad({ qr_enabled: 'yes' })).toThrow(BadRequestException);
  });

  it('treats a blank tax number as absent', () => {
    expect(
      normalizeInvoiceTemplate({ tax_number: '   ' }, true).tax_number,
    ).toBeNull();
  });

  it('lenient mode repairs a corrupt stored value instead of throwing', () => {
    const t = normalizeInvoiceTemplate({
      paper_width: 'x',
      copies: -1,
      logo_url: 'ftp://a',
    });
    expect(t.paper_width).toBe('80mm');
    expect(t.copies).toBe(1);
    expect(t.logo_url).toBeNull();
  });
});

describe('resolveTemplate (tenant vs branch override)', () => {
  const tenant = { footer: 'tenant footer', paper_width: '58mm' };
  const branch = { footer: 'branch footer', paper_width: 'A4' };

  it('uses the tenant template when the branch has none', () => {
    for (const b of [null, undefined, {}]) {
      const r = resolveTemplate('invoice', tenant, b);
      expect(r.source).toBe('tenant');
      expect((r.template as { footer: string }).footer).toBe('tenant footer');
    }
  });

  it('the branch override wins when set', () => {
    const r = resolveTemplate('invoice', tenant, branch);
    expect(r.source).toBe('branch');
    expect((r.template as { footer: string }).footer).toBe('branch footer');
    expect(r.template.paper_width).toBe('A4');
  });

  it('works for the kitchen template too', () => {
    const r = resolveTemplate(
      'kitchen',
      { font_size: 'sm' },
      { font_size: 'lg' },
    );
    expect((r.template as { font_size: string }).font_size).toBe('lg');
  });
});

describe('designer v2 fields', () => {
  it('a template saved before v2 keeps the exact old look (all v2 defaults)', () => {
    const t = normalizeInvoiceTemplate({ paper_width: '58mm', qr_enabled: true });
    const d = defaultInvoiceTemplate();
    expect(t.style).toEqual(d.style);
    expect(t.item_columns).toEqual({ variant: true, qty: true, unit_price: true });
    expect(t.totals_lines).toEqual({ subtotal: true, discount: true });
    expect(t.date_format).toBe('mdy');
    expect(t.time_format).toBe('12h');
    expect(t.labels).toEqual({});
    expect(t.custom_fields).toEqual([]);
  });

  it('accepts a full valid v2 template (strict)', () => {
    const t = normalizeInvoiceTemplate(
      {
        style: { font_size: 'lg', align: 'start', separators: 'solid', accent: 'blue', header_layout: 'text_only' },
        language: 'bilingual',
        item_columns: { variant: false, qty: true, unit_price: false },
        totals_lines: { subtotal: false, discount: true },
        labels: { title: 'Tax invoice', total: 'Grand total' },
        title: 'Simplified Tax Invoice',
        header_text: 'Welcome',
        terms_text: 'No returns after 7 days',
        custom_fields: [{ label: 'Branch no.', value: '12' }],
        date_format: 'dmy',
        time_format: '24h',
        invoice_number: { prefix: 'RIY-', padding: 8 },
      },
      true,
    );
    expect(t.style.font_size).toBe('lg');
    expect(t.language).toBe('bilingual');
    expect(t.item_columns.unit_price).toBe(false);
    expect(t.labels.total).toBe('Grand total');
    expect(t.invoice_number).toEqual({ prefix: 'RIY-', padding: 8 });
  });

  it('rejects bad values on save (strict) but repairs them on read (lenient)', () => {
    const bad = { style: { accent: '#ff0000' } };
    expect(() => normalizeInvoiceTemplate(bad, true)).toThrow(BadRequestException);
    expect(normalizeInvoiceTemplate(bad).style.accent).toBe('black');
    expect(() => normalizeInvoiceTemplate({ labels: { evil: 'x' } }, true)).toThrow(/not a known label/);
    expect(() => normalizeInvoiceTemplate({ labels: { total: 'x'.repeat(41) } }, true)).toThrow(/too long/);
    expect(() =>
      normalizeInvoiceTemplate({ custom_fields: Array.from({ length: 6 }, () => ({ label: 'a', value: 'b' })) }, true),
    ).toThrow(/at most 5/);
    expect(() => normalizeInvoiceTemplate({ invoice_number: { prefix: '<script>' } }, true)).toThrow(BadRequestException);
    expect(() => normalizeInvoiceTemplate({ invoice_number: { padding: 2 } }, true)).toThrow(BadRequestException);
  });

  it('the legally required parts cannot be switched off: no toggle exists for them', () => {
    const t = normalizeInvoiceTemplate({
      totals_lines: { vat: false, total: false },
      item_columns: { name: false, line_total: false },
    });
    expect(Object.keys(t.totals_lines).sort()).toEqual(['discount', 'subtotal']);
    expect(Object.keys(t.item_columns).sort()).toEqual(['qty', 'unit_price', 'variant']);
  });
});
