import { BadRequestException } from '@nestjs/common';
import {
  TemplateRenderService,
  type RenderBody,
} from './template-render.service';
import { sanitizeBody } from './template-body.util';

// Rows of blocks, box styling, icons, currency, index column and free text boxes (design: the
// "same as the reference quotation" layout). Styling is data: fixed keys, validated values.

const svc = new TemplateRenderService();
const render = (
  body: RenderBody,
  data: Record<string, unknown> = {},
  direction: 'rtl' | 'ltr' = 'rtl',
) =>
  svc.render({
    body,
    paper: 'A4',
    orientation: 'portrait',
    direction,
    data,
    assetUrls: {},
  });

describe('layout rows', () => {
  const data = {
    document: { number: 'QT-1', date: '2026-01-20', valid_until: '2026-02-19' },
    customer: { name: 'Acme', phone: '0501234567' },
  };

  it('puts consecutive sideBySide blocks in one row, sized by width', () => {
    const html = render(
      {
        elements: [
          { id: 'a', type: 'document_info', layout: { width: 50 } },
          {
            id: 'b',
            type: 'customer_info',
            layout: { sideBySide: true, width: 50 },
          },
          { id: 'c', type: 'text', config: { text: 'after' } },
        ],
      },
      data,
    );
    expect(html.match(/class="row"/g)).toHaveLength(1);
    expect(html.match(/class="col"/g)).toHaveLength(2);
    expect(html).toContain('calc(50% - 2mm)');
    // the next block without sideBySide starts a new line, after the row
    expect(html.indexOf('data-el="c"')).toBeGreaterThan(
      html.lastIndexOf('class="col"'),
    );
  });

  it('a lone block can be narrowed and placed at the end', () => {
    const html = render({
      elements: [
        {
          id: 'a',
          type: 'text',
          config: { text: 'x' },
          layout: { width: 40, place: 'end' },
        },
      ],
    });
    expect(html).toContain('justify-content:flex-end');
    expect(html).toContain('flex:0 0 40%');
  });
});

describe('block styling', () => {
  it('turns validated style options into CSS on the block wrapper', () => {
    const html = render({
      elements: [
        {
          id: 'h',
          type: 'heading',
          config: { text: 'Quotation' },
          style: {
            bg: '#E9F1FB',
            color: '#0B2A55',
            radius: 8,
            padding: 3,
            align: 'center',
            fontSize: 30,
            weight: 'bold',
          },
        },
      ],
    });
    expect(html).toContain('background:#E9F1FB');
    expect(html).toContain('color:#0B2A55');
    expect(html).toContain('border-radius:8mm');
    expect(html).toContain('font-size:30pt');
    expect(html).toContain('text-align:center');
    expect(html).toContain('font-weight:700');
  });

  it('never lets a non-hex colour or unknown key reach the CSS', () => {
    const html = render({
      elements: [
        {
          id: 'h',
          type: 'text',
          config: { text: 'x' },
          style: {
            bg: 'red;position:fixed',
            color: 'url(javascript:1)',
            evil: 'x',
          },
        },
      ],
    });
    expect(html).not.toContain('position:fixed;');
    expect(html).not.toContain('javascript');
    expect(html).not.toContain('evil');
  });
});

describe('info blocks', () => {
  const data = {
    company: {
      phone: '+966 11 234 5678',
      email: 'info@sefay.com.sa',
      name: 'Sefay',
    },
  };

  it('shows only the chosen fields, in the chosen order', () => {
    const html = render(
      {
        elements: [
          {
            id: 'c',
            type: 'company_info',
            config: { fields: ['email', 'phone'] },
          },
        ],
      },
      data,
    );
    expect(html).not.toContain('Sefay');
    expect(html.indexOf('info@sefay.com.sa')).toBeLessThan(
      html.indexOf('+966 11 234 5678'),
    );
  });

  it('inline label mode and icons', () => {
    const html = render(
      {
        elements: [
          {
            id: 'c',
            type: 'company_info',
            config: { fields: ['phone'], labelMode: 'inline', icons: true },
          },
        ],
      },
      data,
      'ltr',
    );
    expect(html).toContain('class="kv inline"');
    expect(html).toContain('<svg class="ic"');
    expect(html).toContain('Phone:');
  });

  it('label mode "none" prints only icon and value', () => {
    const html = render(
      {
        elements: [
          {
            id: 'c',
            type: 'company_info',
            config: { fields: ['phone'], labelMode: 'none', icons: true },
          },
        ],
      },
      data,
      'ltr',
    );
    expect(html).not.toContain('class="k"');
    expect(html).toContain('+966 11 234 5678');
  });
});

describe('items table and totals', () => {
  const data = {
    items: [
      { name: 'Design', quantity: 1, unit_price: 15000, total: 15000 },
      { name: 'Study', quantity: 2, unit_price: 3250, total: 6500 },
    ],
    totals: [
      { label: 'Subtotal', value: 21500 },
      { label: 'Total', value: 24725, strong: true },
    ],
  };

  it('row number column, header colour and currency suffix (values stay as given)', () => {
    const html = render(
      {
        elements: [
          {
            id: 't',
            type: 'items_table',
            config: {
              headerBg: '#0E4C7A',
              showCurrency: true,
              columns: [
                { key: 'index', label: '#' },
                { key: 'name', label: 'Item' },
                { key: 'total', label: 'Total' },
              ],
            },
          },
        ],
      },
      data,
      'ltr',
    );
    expect(html).toContain('<td class="">1</td>');
    expect(html).toContain('<td class="">2</td>');
    expect(html).toContain('background:#0E4C7A');
    expect(html).toContain('15000.00 SAR');
    expect(html).toContain('6500.00 SAR');
  });

  it('Arabic documents use the riyal label; totals accent colours the strong row', () => {
    const html = render(
      {
        elements: [
          {
            id: 'x',
            type: 'totals',
            config: { showCurrency: true, accent: '#0F7C86' },
          },
        ],
      },
      data,
    );
    expect(html).toContain('24725.00 ر.س');
    expect(html).toContain('class="totals accent"');
    expect(html).toContain('--accent:#0F7C86');
    expect(html).not.toMatch(/[٠-٩]/);
  });

  it('without showCurrency the figures are printed exactly as before', () => {
    const html = render({ elements: [{ id: 'x', type: 'totals' }] }, data);
    expect(html).toContain('>24725.00<');
    expect(html).not.toContain('SAR');
  });
});

describe('text box overlay', () => {
  it('renders a free text with bindings and style at its position', () => {
    const html = render(
      {
        elements: [
          {
            id: 'tb',
            type: 'text_box',
            region: 'overlay',
            position: { x: 20, y: 250 },
            size: { width: 60, height: 12 },
            config: { text: 'Hi {{customer.name}}\nbye' },
            style: { color: '#0B2A55', fontSize: 9, align: 'center' },
          },
        ],
      },
      { customer: { name: 'Acme' } },
    );
    expect(html).toContain('class="ov tb"');
    expect(html).toContain('left:20mm;top:250mm');
    expect(html).toContain('Hi Acme<br>bye');
    expect(html).toContain('font-size:9pt');
  });
});

describe('sanitizeBody: layout, style and new options', () => {
  const ok = (el: Record<string, unknown>) =>
    sanitizeBody({ elements: [{ id: 'e', ...el }] }).elements as Array<
      Record<string, unknown>
    >;

  it('keeps valid style/layout and info options', () => {
    const [e] = ok({
      type: 'customer_info',
      layout: { sideBySide: true, width: 48, place: 'end' },
      style: {
        bg: '#F5F9FE',
        border: '#BFD7EE',
        borderWidth: 0.3,
        radius: 3,
        padding: 3,
      },
      config: { fields: ['name', 'phone'], labelMode: 'inline', icons: true },
    });
    expect(e.layout).toEqual({ sideBySide: true, width: 48, place: 'end' });
    expect(e.style).toEqual({
      bg: '#F5F9FE',
      border: '#BFD7EE',
      borderWidth: 0.3,
      radius: 3,
      padding: 3,
    });
    expect(e.config).toEqual({
      fields: ['name', 'phone'],
      labelMode: 'inline',
      icons: true,
    });
  });

  it.each([
    ['colour not hex', { type: 'text', style: { bg: 'red' } }],
    ['css injection in colour', { type: 'text', style: { color: '#fff;x:y' } }],
    ['radius out of range', { type: 'text', style: { radius: 999 } }],
    [
      'unknown field for the block',
      { type: 'customer_info', config: { fields: ['iban'] } },
    ],
    [
      'bad label mode',
      { type: 'company_info', config: { labelMode: 'weird' } },
    ],
    ['layout width too small', { type: 'text', layout: { width: 1 } }],
    ['bad place', { type: 'text', layout: { place: 'left' } }],
    [
      'bad header colour',
      { type: 'items_table', config: { headerBg: 'blue' } },
    ],
    ['bad accent', { type: 'totals', config: { accent: '#12' } }],
    ['text box without size', { type: 'text_box', position: { x: 1, y: 1 } }],
    [
      'unknown item column',
      {
        type: 'items_table',
        config: { columns: [{ key: 'cost_price', label: 'x' }] },
      },
    ],
  ])('rejects: %s', (_n, el) => {
    expect(() => ok(el)).toThrow(BadRequestException);
  });

  it('accepts the index column, a text box, and strips style on image overlays', () => {
    const [t] = ok({
      type: 'items_table',
      config: {
        columns: [
          { key: 'index', label: '#' },
          { key: 'name', label: 'Item' },
        ],
      },
    });
    expect(t.config).toEqual({
      columns: [
        { key: 'index', label: '#' },
        { key: 'name', label: 'Item' },
      ],
    });
    const [box] = ok({
      type: 'text_box',
      position: { x: 10, y: 20 },
      size: { width: 50, height: 10 },
      config: { text: 'Prepared by {{company.name}}' },
      style: { fontSize: 9, weight: 'bold' },
    });
    expect(box.region).toBe('overlay');
    expect(box.style).toEqual({ fontSize: 9, weight: 'bold' });
    const [qr] = ok({
      type: 'qr',
      config: { kind: 'verification' },
      position: { x: 1, y: 1 },
      size: { width: 30, height: 30 },
      style: { bg: '#ffffff' },
    });
    expect(qr.style).toBeUndefined();
  });

  it('still rejects unknown bindings in a text box', () => {
    expect(() =>
      ok({
        type: 'text_box',
        position: { x: 1, y: 1 },
        size: { width: 20, height: 10 },
        config: { text: '{{totals.value}}' },
      }),
    ).toThrow(BadRequestException);
  });
});

describe('free-positioned blocks', () => {
  it('takes a block out of the flow and places it at page millimetres', () => {
    const html = render({
      elements: [
        { id: 'a', type: 'text', config: { text: 'flowing' } },
        {
          id: 'b',
          type: 'text',
          config: { text: 'floating' },
          layout: { free: { x: 12.5, y: 80, width: 90 } },
        },
      ],
    });
    expect(html).toContain('class="free" style="left:12.5mm;top:80mm;width:90mm"');
    // the free block is no longer inside the flow container
    expect(html.indexOf('data-el="b"')).toBeGreaterThan(html.indexOf('</table>'));
    expect(html.indexOf('data-el="a"')).toBeLessThan(html.indexOf('</table>'));
  });

  it('validates the free spot', () => {
    const body = (free: unknown) => ({
      elements: [{ id: 'a', type: 'text', layout: { free } }],
    });
    expect(() => sanitizeBody(body({ x: 5, y: 5, width: 100 }))).not.toThrow();
    expect(() => sanitizeBody(body({ x: 5, y: 5, width: 1 }))).toThrow(
      BadRequestException,
    );
    expect(() => sanitizeBody(body('x'))).toThrow(BadRequestException);
  });
});
