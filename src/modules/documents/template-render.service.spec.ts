import {
  TemplateRenderService,
  interpolate,
  lookup,
  type RenderBody,
} from './template-render.service';

const svc = new TemplateRenderService();
const base = {
  paper: 'A4',
  orientation: 'portrait',
  direction: 'rtl' as 'rtl' | 'ltr',
  data: {} as Record<string, unknown>,
  assetUrls: {} as Record<string, string>,
};
const render = (body: RenderBody, over: Partial<typeof base> = {}) =>
  svc.render({ ...base, ...over, body });

describe('TemplateRenderService', () => {
  it('sets direction, language and the paper size', () => {
    const html = render({}, { direction: 'rtl' });
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('size: 210mm 297mm');
    expect(render({}, { paper: 'A5', orientation: 'landscape' })).toContain(
      'size: 210mm 148mm',
    );
    expect(render({}, { paper: '80mm' })).toContain('size: 80mm auto');
  });

  it('escapes template text and data (no HTML/script injection)', () => {
    const html = render(
      {
        elements: [
          {
            type: 'text',
            config: { text: '<script>x</script> {{customer.name}}' },
          },
        ],
      },
      { data: { customer: { name: '"><img src=x onerror=alert(1)>' } } },
    );
    expect(html).not.toContain('<script>x');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;');
  });

  it('interpolation never walks the prototype chain', () => {
    expect(lookup({ a: 1 }, '__proto__.polluted')).toBeUndefined();
    expect(lookup({ a: {} }, 'a.constructor')).toBeUndefined();
    expect(interpolate('{{constructor}}', {})).toBe('');
  });

  it('prints money with English numerals and 2 decimals', () => {
    const html = render(
      { elements: [{ type: 'totals' }] },
      { data: { totals: [{ label: 'Total', value: 1234.5, strong: true }] } },
    );
    expect(html).toContain('1234.50');
    expect(html).not.toMatch(/[٠-٩]/);
  });

  it('items table has a repeating header and only declared columns', () => {
    const html = render(
      {
        elements: [
          {
            type: 'items_table',
            config: {
              columns: [
                { key: 'name', label: 'Item' },
                { key: 'total', label: 'Total', align: 'center' },
              ],
            },
          },
        ],
      },
      { data: { items: [{ name: 'A', total: 5, secret: 'ZZLEAK' }] } },
    );
    expect(html).toContain('<thead>');
    expect(html).toContain('5.00');
    expect(html).not.toContain('ZZLEAK');
  });

  it('overlay elements keep independent geometry; same asset can be placed twice', () => {
    const url = 'https://signed.example/stamp.png';
    const html = render(
      {
        elements: [
          {
            type: 'stamp',
            assetId: 'a1',
            position: { x: 145, y: 220 },
            size: { width: 38, height: 38 },
            rotation: -12,
            opacity: 0.75,
            zIndex: 5,
          },
          {
            type: 'stamp',
            assetId: 'a1',
            position: { x: 10, y: 20 },
            size: { width: 20, height: 20 },
            rotation: 30,
            opacity: 0.5,
            zIndex: 2,
          },
        ],
      },
      { assetUrls: { a1: url } },
    );
    expect(html.match(/<img class="ov"/g)).toHaveLength(2);
    expect(html).toContain(
      'left:145mm;top:220mm;width:38mm;height:38mm;transform:rotate(-12deg);opacity:0.75;z-index:5',
    );
    expect(html).toContain(
      'left:10mm;top:20mm;width:20mm;height:20mm;transform:rotate(30deg);opacity:0.5;z-index:2',
    );
  });

  it('draws nothing for an asset that was not resolved for this tenant', () => {
    const html = render({ elements: [{ type: 'stamp', assetId: 'foreign' }] });
    expect(html).not.toContain('<img');
  });

  it('refuses non-https image URLs', () => {
    const html = render(
      { elements: [{ type: 'logo', assetId: 'a1' }] },
      { assetUrls: { a1: 'javascript:alert(1)' } },
    );
    expect(html).not.toContain('<img');
    const http = render(
      { elements: [{ type: 'logo', assetId: 'a1' }] },
      { assetUrls: { a1: 'http://insecure/x.png' } },
    );
    expect(http).not.toContain('<img');
  });

  it('hidden elements and unknown types render nothing', () => {
    const html = render({
      elements: [
        { type: 'text', visible: false, config: { text: 'SECRET' } },
        { type: 'script', config: { text: 'boom' } },
      ],
    });
    expect(html).not.toContain('SECRET');
    expect(html).not.toContain('boom');
  });

  it('clamps absurd overlay values', () => {
    const html = render(
      {
        elements: [
          {
            type: 'image',
            assetId: 'a1',
            opacity: 99,
            rotation: 99999,
            size: { width: 1e9, height: -5 },
          },
        ],
      },
      { assetUrls: { a1: 'https://s/x.png' } },
    );
    expect(html).toContain('opacity:1');
    expect(html).toContain('rotate(360deg)');
    expect(html).toContain('width:1000mm;height:1mm');
  });

  it('non-whitelisted data never reaches the page (even if the data object has it)', () => {
    const html = render(
      {
        elements: [
          {
            id: 'a',
            type: 'text',
            config: { text: '{{customer.credit_limit}} {{customer.name}}' },
          },
          { id: 'b', type: 'customer_info' },
        ],
      },
      {
        data: {
          customer: {
            name: 'Acme',
            credit_limit: 'LEAK-999',
            internal_note: 'LEAK-123',
          },
        },
      },
    );
    expect(html).toContain('Acme');
    expect(html).not.toContain('LEAK');
  });

  it('structured blocks use catalog labels, in the page language', () => {
    const data = { company: { name: 'Acme', vat_number: '3000' } };
    expect(
      render({ elements: [{ id: 'a', type: 'company_info' }] }, { data }),
    ).toContain('اسم الشركة');
    expect(
      render(
        { elements: [{ id: 'a', type: 'company_info' }] },
        { data, direction: 'ltr' },
      ),
    ).toContain('Company name');
  });

  it('missing values print nothing, or a dash when configured', () => {
    const body = (missingValue?: 'dash') => ({
      missingValue,
      elements: [
        {
          id: 'a',
          type: 'text',
          config: { text: 'Ref: [{{document.reference}}]' },
        },
      ],
    });
    expect(render(body())).toContain('Ref: []');
    expect(render(body('dash'))).toContain('Ref: [—]');
  });

  it('wraps blocks with data-el so the editor can select them', () => {
    expect(render({ elements: [{ id: 'blk-1', type: 'divider' }] })).toContain(
      'data-el="blk-1"',
    );
  });

  it('repeats margins on every printed page via thead/tfoot spacers', () => {
    const html = render({
      pages: [{ marginsMm: { top: 30, right: 12, bottom: 25, left: 8 } }],
      elements: [{ id: 'a', type: 'divider' }],
    });
    expect(html).toContain(
      '<thead><tr><td style="height:30mm;padding:0"></td></tr></thead>',
    );
    expect(html).toContain(
      '<tfoot><tr><td style="height:25mm;padding:0"></td></tr></tfoot>',
    );
    expect(html).toContain('padding:0 12mm 0 8mm');
  });

  it('page_break forces a new page; table options are applied', () => {
    const html = render(
      {
        elements: [
          { id: 'a', type: 'page_break' },
          {
            id: 'b',
            type: 'items_table',
            config: {
              zebra: true,
              repeatHeader: false,
              columns: [{ key: 'name', label: 'Item', width: 40 }],
            },
          },
        ],
      },
      { data: { items: [{ name: 'x' }] } },
    );
    expect(html).toContain('class="pagebreak"');
    expect(html).toContain('class="items zebra norepeat"');
    expect(html).toContain('style="width:40%"');
  });

  it('header repeats by default', () => {
    const html = render({
      elements: [
        {
          id: 'b',
          type: 'items_table',
          config: { columns: [{ key: 'name', label: 'Item' }] },
        },
      ],
    });
    expect(html).toContain('class="items"');
  });

  it('anchor "every" prints the overlay on every page (fixed); default is page 1 only', () => {
    const el = {
      type: 'stamp',
      assetId: 'a1',
      position: { x: 1, y: 2 },
      size: { width: 10, height: 10 },
    };
    const urls = { a1: 'https://s/x.png' };
    expect(
      render(
        { elements: [{ ...el, id: 'e1', anchor: 'every' as const }] },
        { assetUrls: urls },
      ),
    ).toContain('class="ov fixed"');
    expect(
      render({ elements: [{ ...el, id: 'e2' }] }, { assetUrls: urls }),
    ).toContain('class="ov"');
  });
});
