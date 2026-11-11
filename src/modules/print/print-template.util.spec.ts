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
