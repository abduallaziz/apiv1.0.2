import { BadRequestException } from '@nestjs/common';
import { referencedAssetIds, sanitizeBody } from './template-body.util';

const UUID = '11111111-1111-4111-8111-111111111111';
const stamp = (over: Record<string, unknown> = {}) => ({
  id: 'el-1',
  type: 'stamp',
  assetId: UUID,
  position: { x: 145, y: 220 },
  size: { width: 38, height: 38 },
  rotation: -12,
  opacity: 0.75,
  zIndex: 5,
  locked: false,
  visible: true,
  maintainAspect: true,
  ...over,
});

describe('sanitizeBody', () => {
  it('keeps overlay geometry exactly (x/y/size/rotation/opacity/z) per instance', () => {
    const body = sanitizeBody({
      elements: [
        stamp(),
        stamp({
          id: 'el-2',
          position: { x: 10, y: 20 },
          rotation: 30,
          opacity: 0.5,
          zIndex: 2,
        }),
      ],
    });
    const els = body.elements as Array<Record<string, unknown>>;
    expect(els).toHaveLength(2);
    expect(els[0]).toMatchObject({
      region: 'overlay',
      position: { x: 145, y: 220 },
      rotation: -12,
      opacity: 0.75,
      zIndex: 5,
    });
    expect(els[1]).toMatchObject({
      position: { x: 10, y: 20 },
      rotation: 30,
      opacity: 0.5,
      zIndex: 2,
    });
    expect(referencedAssetIds(body)).toEqual([UUID]); // same asset placed twice = one id
  });

  it('strips unknown keys (nothing unexpected is stored)', () => {
    const body = sanitizeBody({
      elements: [
        { ...stamp(), evil: '<script>', config: { text: 'x', onclick: 'y' } },
      ],
      extra: 1,
    });
    const el = (body.elements as Array<Record<string, unknown>>)[0];
    expect(el).not.toHaveProperty('evil');
    expect(el.config).toEqual({ text: 'x' });
    expect(body).not.toHaveProperty('extra');
  });

  it.each([
    ['unknown type', { elements: [{ id: 'a', type: 'script' }] }],
    ['opacity out of range', { elements: [stamp({ opacity: 2 })] }],
    ['rotation out of range', { elements: [stamp({ rotation: 999 })] }],
    ['huge size', { elements: [stamp({ size: { width: 1e9, height: 5 } })] }],
    ['non-uuid asset', { elements: [stamp({ assetId: 'abc' })] }],
    ['stamp without asset', { elements: [{ id: 'a', type: 'stamp' }] }],
    ['bad id chars', { elements: [stamp({ id: '"><x' })] }],
    ['duplicate ids', { elements: [stamp(), stamp()] }],
    ['missing page', { elements: [stamp({ page: 3 })] }],
    [
      'too many elements',
      {
        elements: Array.from({ length: 301 }, (_, i) => ({
          id: `e${i}`,
          type: 'divider',
        })),
      },
    ],
    ['bad paper', { pages: [{ size: 'A0' }] }],
    ['non-object body', 'nope'],
  ])('rejects %s', (_n, body) => {
    expect(() => sanitizeBody(body)).toThrow(BadRequestException);
  });

  it('validates table columns', () => {
    expect(() =>
      sanitizeBody({
        elements: [
          {
            id: 't',
            type: 'items_table',
            config: { columns: [{ key: 'a b', label: 'x' }] },
          },
        ],
      }),
    ).toThrow(BadRequestException);
    const ok = sanitizeBody({
      elements: [
        {
          id: 't',
          type: 'items_table',
          config: {
            columns: [{ key: 'name', label: 'Item', align: 'center' }],
          },
        },
      ],
    });
    expect(ok.elements).toHaveLength(1);
  });

  it('defaults to a single empty page', () => {
    expect(sanitizeBody({})).toEqual({
      pages: [{}],
      elements: [],
      bindings: [],
    });
  });

  it('rejects unknown bindings and derives the stored list from the texts', () => {
    expect(() =>
      sanitizeBody({
        elements: [
          { id: 't', type: 'text', config: { text: 'x {{secret.token}}' } },
        ],
      }),
    ).toThrow(BadRequestException);
    const ok = sanitizeBody({
      bindings: ['evil.path'], // client-supplied list is ignored
      elements: [
        {
          id: 'a',
          type: 'text',
          config: { text: '{{customer.name}} / {{ document.number }}' },
        },
        { id: 'b', type: 'heading', config: { text: '{{customer.name}}' } },
      ],
    });
    expect(ok.bindings).toEqual(['customer.name', 'document.number']);
  });

  it('only known item columns and a valid missingValue are accepted', () => {
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
    ).toThrow(BadRequestException);
    expect(() => sanitizeBody({ missingValue: 'x' })).toThrow(
      BadRequestException,
    );
    expect(sanitizeBody({ missingValue: 'dash' }).missingValue).toBe('dash');
  });

  it('accepts page_break, table options, column widths and overlay anchor; rejects bad ones', () => {
    const ok = sanitizeBody({
      elements: [
        { id: 'p', type: 'page_break' },
        {
          id: 't',
          type: 'items_table',
          config: {
            zebra: true,
            repeatHeader: false,
            columns: [{ key: 'name', label: 'Item', width: 40 }],
          },
        },
        stamp({ id: 's', anchor: 'every' }),
      ],
    });
    const els = ok.elements as Array<Record<string, unknown>>;
    expect(els[1].config).toMatchObject({ zebra: true, repeatHeader: false });
    expect(els[2].anchor).toBe('every');
    expect(() =>
      sanitizeBody({ elements: [stamp({ anchor: 'last' })] }),
    ).toThrow(BadRequestException);
    expect(() =>
      sanitizeBody({
        elements: [
          {
            id: 't',
            type: 'items_table',
            config: { columns: [{ key: 'name', label: 'x', width: 500 }] },
          },
        ],
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      sanitizeBody({
        elements: [{ id: 't', type: 'items_table', config: { zebra: 'yes' } }],
      }),
    ).toThrow(BadRequestException);
  });
});

describe('sanitizeBody QR rules', () => {
  const qr = (
    config: Record<string, unknown>,
    over: Record<string, unknown> = {},
  ) => ({
    id: 'q',
    type: 'qr',
    config,
    position: { x: 10, y: 10 },
    size: { width: 30, height: 30 },
    ...over,
  });
  const cfgOf = (body: Record<string, unknown>) =>
    (body.elements as Array<Record<string, unknown>>)[0].config;

  it('accepts a verification QR with no asset and keeps only its kind', () => {
    const body = sanitizeBody({
      elements: [qr({ kind: 'verification', junk: 1 })],
    });
    expect(cfgOf(body)).toEqual({ kind: 'verification' });
  });

  it('signature_qr is forced to the verification kind', () => {
    const body = sanitizeBody({
      elements: [
        qr(
          { kind: 'custom_url', url: 'https://x.co' },
          { type: 'signature_qr' },
        ),
      ],
    });
    expect(cfgOf(body)).toEqual({ kind: 'verification' });
  });

  it.each([
    ['unknown kind', qr({ kind: 'wifi' })],
    ['custom url not https', qr({ kind: 'custom_url', url: 'http://x.co' })],
    [
      'custom url javascript',
      qr({ kind: 'custom_url', url: 'javascript:alert(1)' }),
    ],
    [
      'too small',
      qr({ kind: 'verification' }, { size: { width: 8, height: 8 } }),
    ],
    [
      'not square',
      qr({ kind: 'verification' }, { size: { width: 40, height: 25 } }),
    ],
    ['faint', qr({ kind: 'verification' }, { opacity: 0.3 })],
    ['no size', qr({ kind: 'verification' }, { size: undefined })],
  ])('rejects %s', (_n, el) => {
    expect(() => sanitizeBody({ elements: [el] })).toThrow(BadRequestException);
  });
});
