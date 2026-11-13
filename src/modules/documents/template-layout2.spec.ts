import { BadRequestException } from '@nestjs/common';
import {
  TemplateRenderService,
  type RenderBody,
} from './template-render.service';
import { sanitizeBody } from './template-body.util';

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

describe('table: description column, bold columns, grid', () => {
  const data = {
    items: [
      {
        name: 'PM',
        description: 'Plan & track',
        quantity: 1,
        unit_price: 100,
        total: 100,
      },
    ],
  };
  const body: RenderBody = {
    elements: [
      {
        id: 't',
        type: 'items_table',
        config: {
          grid: true,
          columns: [
            { key: 'name', label: 'Item', bold: true },
            { key: 'description', label: 'Description' },
          ],
        },
      },
    ],
  };

  it('prints the description (escaped), bold name cells and the grid class', () => {
    const html = render(body, data, 'ltr');
    expect(html).toContain('Plan &amp; track');
    expect(html).toContain('class=" b">PM</td>');
    expect(html).toContain('class="items grid"');
  });
});

describe('totals colours', () => {
  const data = {
    totals: [
      { label: 'Subtotal', value: 100 },
      { label: 'Total', value: 115, strong: true },
    ],
  };
  it('label background, accent for the label and a second colour for the value', () => {
    const html = render(
      {
        elements: [
          {
            id: 'x',
            type: 'totals',
            config: {
              labelBg: '#E8F1FA',
              accent: '#0F7C86',
              accentValue: '#0F4C81',
            },
          },
        ],
      },
      data,
    );
    expect(html).toContain('--accent:#0F7C86');
    expect(html).toContain('--accent2:#0F4C81');
    expect(html).toContain('--lbl:#E8F1FA');
  });
});

describe('terms with a title and bullets', () => {
  it('renders a title pill and a bullet list; plain terms are unchanged', () => {
    const html = render({
      elements: [
        {
          id: 't',
          type: 'terms',
          config: {
            title: 'Terms',
            titleBg: '#0F4C81',
            bulletColor: '#14B8A6',
            text: '• First <b>\n• Second',
          },
        },
      ],
    });
    expect(html).toContain('class="th" style="background:#0F4C81"');
    expect(html).toContain('<li>First &lt;b&gt;</li><li>Second</li>');
    expect(html).toContain('--bullet:#14B8A6');
    const plain = render({
      elements: [{ id: 'p', type: 'terms', config: { text: 'a\nb' } }],
    });
    expect(plain).toContain('<div class="text terms">a<br>b</div>');
  });
});

describe('info rows band and column divider', () => {
  it('rowBg bands the rows; divider marks the column', () => {
    const html = render(
      {
        elements: [
          {
            id: 'a',
            type: 'customer_info',
            config: { rowBg: '#EAF2FB' },
            layout: { width: 50 },
          },
          {
            id: 'b',
            type: 'text',
            config: { text: 'x' },
            layout: { sideBySide: true, width: 50, divider: true },
          },
        ],
      },
      { customer: { name: 'Acme' } },
    );
    expect(html).toContain('block customer band');
    expect(html).toContain('--row:#EAF2FB');
    expect(html).toContain('class="col div"');
  });
});

describe('sanitizeBody: new options', () => {
  const ok = (el: Record<string, unknown>) =>
    sanitizeBody({ elements: [{ id: 'e', ...el }] }).elements as Array<
      Record<string, unknown>
    >;

  it('keeps valid values', () => {
    const [t] = ok({
      type: 'terms',
      config: {
        title: 'T',
        titleBg: '#112233',
        bulletColor: '#445566',
        text: 'x',
      },
      layout: { divider: true },
    });
    expect(t.config).toEqual({
      title: 'T',
      titleBg: '#112233',
      bulletColor: '#445566',
      text: 'x',
    });
    expect(t.layout).toEqual({ divider: true });
    const [tot] = ok({
      type: 'totals',
      config: { accent: '#0F7C86', accentValue: '#0F4C81', labelBg: '#E8F1FA' },
    });
    expect(tot.config).toEqual({
      accent: '#0F7C86',
      accentValue: '#0F4C81',
      labelBg: '#E8F1FA',
    });
    const [tbl] = ok({
      type: 'items_table',
      config: {
        grid: true,
        columns: [{ key: 'description', label: 'D', bold: true }],
      },
    });
    expect(tbl.config).toEqual({
      grid: true,
      columns: [{ key: 'description', label: 'D', bold: true }],
    });
    const [info] = ok({ type: 'company_info', config: { rowBg: '#EAF2FB' } });
    expect(info.config).toEqual({ rowBg: '#EAF2FB' });
  });

  it.each([
    ['bad bullet colour', { type: 'terms', config: { bulletColor: 'green' } }],
    ['bad row colour', { type: 'customer_info', config: { rowBg: 'x' } }],
    ['bad label bg', { type: 'totals', config: { labelBg: '#12' } }],
    ['non boolean grid', { type: 'items_table', config: { grid: 'yes' } }],
    [
      'non boolean bold',
      {
        type: 'items_table',
        config: { columns: [{ key: 'name', label: 'x', bold: 1 }] },
      },
    ],
    ['non boolean divider', { type: 'text', layout: { divider: 'x' } }],
  ])('rejects: %s', (_n, el) => {
    expect(() => ok(el)).toThrow(BadRequestException);
  });
});
