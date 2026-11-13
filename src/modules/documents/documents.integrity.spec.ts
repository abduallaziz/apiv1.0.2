import * as fs from 'fs';
import * as path from 'path';
import {
  TemplateRenderService,
  type RenderBody,
} from './template-render.service';
import { sanitizeBody } from './template-body.util';
import { filterResolvedData } from './bindings.catalog';

// Cross-cutting guarantees of the Document Builder (design §1, §11): templates cannot change
// money, the module cannot touch the financial code, and mixed RTL/LTR content renders safely.

const DIR = __dirname;
const read = (f: string) => fs.readFileSync(path.join(DIR, f), 'utf8');
const sources = fs
  .readdirSync(DIR)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'));

const svc = new TemplateRenderService();
const base = {
  paper: 'A4',
  orientation: 'portrait',
  direction: 'rtl' as 'rtl' | 'ltr',
  assetUrls: {},
};

describe('financial integrity: a template can never change money', () => {
  const data = {
    items: [
      { name: 'A', quantity: 2, unit_price: 50, total: 100 },
      { name: 'B', quantity: 1, unit_price: 250, total: 250 },
    ],
    totals: [
      { label: 'Subtotal', value: 350 },
      { label: 'VAT 15%', value: 52.5 },
      { label: 'Total', value: 402.5, strong: true },
    ],
  };

  const renderWith = (body: RenderBody) => svc.render({ ...base, body, data });

  it('prints the backend totals exactly, whatever the template looks like', () => {
    const plain = renderWith({ elements: [{ id: 't', type: 'totals' }] });
    const decorated = renderWith({
      missingValue: 'dash',
      elements: [
        {
          id: 'h',
          type: 'heading',
          config: { text: 'Total: {{document.total}} {{totals.value}}' },
        },
        {
          id: 'tbl',
          type: 'items_table',
          config: { zebra: true, columns: [{ key: 'total', label: 'Amount' }] },
        },
        { id: 't', type: 'totals' },
      ],
    });
    for (const html of [plain, decorated]) {
      expect(html).toContain('350.00');
      expect(html).toContain('52.50');
      expect(html).toContain('402.50');
    }
  });

  it('a template cannot inject, compute or override figures', () => {
    // arithmetic / expressions are plain text, never evaluated
    const html = renderWith({
      elements: [
        {
          id: 'x',
          type: 'text',
          config: { text: '{{1+1}} {{totals[0].value*2}} ${7*7} #{7*7}' },
        },
      ],
    });
    expect(html).not.toContain('>2<');
    expect(html).not.toContain('805'); // 402.5 * 2
    expect(html).not.toContain('49');
    // only whitelisted names are accepted when a template is saved
    expect(() =>
      sanitizeBody({
        elements: [
          { id: 'x', type: 'text', config: { text: '{{totals.value}}' } },
        ],
      }),
    ).toThrow();
    expect(() =>
      sanitizeBody({
        elements: [{ id: 'x', type: 'text', config: { text: '{{ 1+1 }}' } }],
      }),
    ).toThrow();
  });

  it('items columns cannot reach cost or internal fields', () => {
    expect(() =>
      sanitizeBody({
        elements: [
          {
            id: 't',
            type: 'items_table',
            config: { columns: [{ key: 'cost_price', label: 'x' }] },
          },
        ],
      }),
    ).toThrow();
    const leaked = filterResolvedData({
      items: [{ name: 'A', total: 1, cost_price: 99, supplier: 'S' }],
    });
    expect(JSON.stringify(leaked)).not.toContain('cost_price');
    expect(JSON.stringify(leaked)).not.toContain('supplier');
  });
});

describe('isolation from the financial code', () => {
  it('never writes to orders / invoices / accounting / ZATCA tables', () => {
    const forbidden =
      /(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(orders|order_items|invoices|invoice_sequences|journal_|zatca_|payments|customers|tenants)/i;
    for (const f of sources) {
      expect(read(f)).not.toMatch(forbidden);
    }
  });

  it('does not import the invoices / zatca / accounting / pos modules (only the QR util and PDF engine are reused)', () => {
    const bad =
      /from\s+'\.\.\/(invoices|zatca|accounting|sales-returns|payments)\//;
    for (const f of sources) {
      expect(read(f)).not.toMatch(bad);
    }
    // the allowed reuse, as designed: ZATCA QR util + the PDF renderer + private storage
    expect(read('generation.service.ts')).toContain('../print/zatca-qr.util');
    expect(read('generation.service.ts')).toContain(
      '../shifts/report/pdf-renderer.service',
    );
  });

  it('every tenant-scoped query carries tenant_id', () => {
    for (const f of [
      'templates.service.ts',
      'assets.service.ts',
      'generation.service.ts',
    ]) {
      const queries = [
        ...read(f).matchAll(/`(\s*(?:SELECT|UPDATE|INSERT|DELETE)[\s\S]*?)`/g),
      ].map((m) => m[1]);
      expect(queries.length).toBeGreaterThan(0);
      for (const q of queries) {
        // joined helper tables (templates/versions via current_version_id) and id-only lookups on a
        // row that was already tenant-checked in the same transaction are the only exemptions
        const ok =
          /tenant_id/.test(q) ||
          /FROM roles/.test(q) || // system roles are shared; filtered by (tenant_id IS NULL OR ...)
          /document_template_versions\s+WHERE/.test(q) ||
          /document_asset_versions/.test(q) ||
          /document_template_versions/.test(q) ||
          /FROM branches/.test(q);
        expect({ file: f, ok, q: q.slice(0, 80) }).toEqual({
          file: f,
          ok: true,
          q: q.slice(0, 80),
        });
      }
    }
  });
});

describe('RTL, long Arabic and mixed LTR content', () => {
  const longArabic =
    'هذا نص عربي طويل جدا لاختبار التفاف الأسطر وعدم قص المحتوى داخل المستند '.repeat(
      12,
    );

  it('renders RTL pages with logical alignment and wrapping rules', () => {
    const html = svc.render({
      ...base,
      body: {
        elements: [
          { id: 't', type: 'text', config: { text: longArabic } },
          { id: 'c', type: 'company_info' },
        ],
      },
      data: {
        company: { name: 'شركة العينة Sample Co. 123', phone: '0500000000' },
      },
    });
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('lang="ar"');
    expect(html).toContain('overflow-wrap: anywhere');
    expect(html).toContain('unicode-bidi: plaintext');
    expect(html).toContain('شركة العينة Sample Co. 123'); // mixed content kept intact
    expect(html).toContain(longArabic.trim().slice(0, 40));
  });

  it('numbers stay Western digits in Arabic documents', () => {
    const html = svc.render({
      ...base,
      body: { elements: [{ id: 't', type: 'totals' }] },
      data: { totals: [{ label: 'الإجمالي', value: 1234.5, strong: true }] },
    });
    expect(html).toContain('1234.50');
    expect(html).not.toMatch(/[٠-٩]/);
  });

  it('LTR pages use ltr direction and English labels', () => {
    const html = svc.render({
      ...base,
      direction: 'ltr',
      body: { elements: [{ id: 'c', type: 'company_info' }] },
      data: { company: { name: 'Acme' } },
    });
    expect(html).toContain('dir="ltr"');
    expect(html).toContain('Company name');
  });
});
