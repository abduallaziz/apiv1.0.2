import { PrintService, detectImageType } from './print.service';

const TENANT = 't1';
const baseTenant = {
  id: TENANT,
  name: 'Sefay Wash',
  address: 'Riyadh',
  phone: '0500000000',
  tax_number: '300000000000003',
  logo_url: 'https://cdn.example/logo.png',
  invoice_footer: 'Thanks',
  tax_rate: 0.15,
  tax_inclusive_pricing: false,
  currency_symbol: 'SAR',
  printer_settings: { paper_width: '58mm', auto_print: true },
  invoice_template: {},
  kitchen_template: {},
};
const order = {
  id: 'aaaaaaaa-0000-0000-0000-00000000abcd',
  branch_id: 'b1',
  cashier_id: 'u1',
  customer_id: 'c1',
  table_id: null,
  status: 'completed',
  subtotal: 25,
  discount: 0,
  tax: 3.75,
  total: 28.75,
  payment_method: 'cash',
  cash_amount: null,
  card_amount: null,
  notes: 'rush',
  created_at: '2026-01-01T10:00:00Z',
};
const items = [
  {
    id: 'i1',
    item_name: 'Wash',
    variant_name: null,
    qty: 1,
    price: 25,
    total_price: 25,
    kitchen_status: null,
  },
  {
    id: 'i2',
    item_name: 'Soup',
    variant_name: 'L',
    qty: 2,
    price: 5,
    total_price: 10,
    kitchen_status: 'pending',
  },
  {
    id: 'i3',
    item_name: 'Tea',
    variant_name: null,
    qty: 1,
    price: 3,
    total_price: 3,
    kitchen_status: 'preparing',
  },
];

function build(
  over: { tenant?: object; branch?: object; order?: object } = {},
) {
  const repo = {
    getTenant: jest.fn().mockResolvedValue({ ...baseTenant, ...over.tenant }),
    getBranch: jest.fn().mockResolvedValue({
      id: 'b1',
      address: 'Branch addr',
      invoice_template: null,
      kitchen_template: null,
      ...over.branch,
    }),
    getOrder: jest.fn().mockResolvedValue({ ...order, ...over.order }),
    getOrderItems: jest.fn().mockResolvedValue(items),
    getCashierName: jest.fn().mockResolvedValue('Ali'),
    getCustomer: jest.fn().mockResolvedValue({
      full_name: 'Omar',
      phone: '055',
      plate_number: 'ABC 1234',
    }),
    getTableName: jest.fn().mockResolvedValue('T5'),
  };
  const storage = {
    getSignedUrl: jest.fn().mockResolvedValue('https://signed/logo'),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };

  const svc = new PrintService(repo as any, storage as any, audit as any);
  return { svc };
}

describe('PrintService.getInvoicePayload', () => {
  it('returns the full payload shape with tenant fallbacks and no QR by default', async () => {
    const { svc } = build();
    const p = await svc.getInvoicePayload(TENANT, order.id);
    expect(p.order_number).toBe('00ABCD');
    expect(p.business).toMatchObject({
      name: 'Sefay Wash',
      address: 'Branch addr',
      phone: '0500000000',
      tax_number: '300000000000003',
      logo_url: 'https://cdn.example/logo.png',
      footer: 'Thanks',
    });
    expect(p.items).toHaveLength(3);
    expect(p.totals).toMatchObject({ total: 28.75, tax: 3.75, tax_rate: 0.15 });
    expect(p.payments).toEqual([{ method: 'cash', amount: 28.75 }]);
    expect(p.cashier_name).toBe('Ali');
    expect(p.vehicle_plate).toBe('ABC 1234');
    expect(p.note).toBe('rush');
    expect(p.qr_base64).toBeNull();
    expect(p.change).toBeNull();
    // no saved template yet: legacy Settings > Printer paper width + auto_print apply
    expect(p.template.paper_width).toBe('58mm');
    expect(p.auto_print).toBe(true);
  });

  it('computes change only for cash with a valid tendered amount', async () => {
    const { svc } = build();
    expect(
      (await svc.getInvoicePayload(TENANT, order.id, { tendered: 50 })).change,
    ).toBe(21.25);
    expect(
      (await svc.getInvoicePayload(TENANT, order.id, { tendered: 10 })).change,
    ).toBeNull();
  });

  it('returns both lines for a split payment', async () => {
    const { svc } = build({
      order: { payment_method: 'split', cash_amount: 10, card_amount: 18.75 },
    });
    const p = await svc.getInvoicePayload(TENANT, order.id, { tendered: 99 });
    expect(p.payments).toEqual([
      { method: 'cash', amount: 10 },
      { method: 'card', amount: 18.75 },
    ]);
    expect(p.change).toBeNull();
  });

  it('QR only when qr_enabled AND a tax number exists', async () => {
    const on = build({ tenant: { invoice_template: { qr_enabled: true } } });
    expect(
      (await on.svc.getInvoicePayload(TENANT, order.id)).qr_base64,
    ).toEqual(expect.any(String));

    const noTax = build({
      tenant: { tax_number: null, invoice_template: { qr_enabled: true } },
    });
    const p = await noTax.svc.getInvoicePayload(TENANT, order.id);
    expect(p.qr_base64).toBeNull();
    expect(p.business.tax_number).toBeNull();
  });

  it('branch override wins over the tenant template and tenant business fields', async () => {
    const { svc } = build({
      tenant: { invoice_template: { footer: 'T', paper_width: '58mm' } },
      branch: {
        invoice_template: {
          footer: 'B',
          paper_width: 'A4',
          business_name: 'Branch Name',
        },
      },
    });
    const p = await svc.getInvoicePayload(TENANT, order.id);
    expect(p.template.paper_width).toBe('A4');
    expect(p.business.footer).toBe('B');
    expect(p.business.name).toBe('Branch Name');
  });

  it('uses a signed URL for an uploaded logo and none when show_logo=false', async () => {
    const a = build({
      tenant: {
        invoice_template: { logo_path: `${TENANT}/print-logo/x/logo.png` },
      },
    });
    expect(
      (await a.svc.getInvoicePayload(TENANT, order.id)).business.logo_url,
    ).toBe('https://signed/logo');
    const b = build({ tenant: { invoice_template: { show_logo: false } } });
    expect(
      (await b.svc.getInvoicePayload(TENANT, order.id)).business.logo_url,
    ).toBeNull();
  });
});

describe('PrintService.getKitchenPayload', () => {
  it('has no prices and skips lines the kitchen already handled', async () => {
    const { svc } = build({ order: { table_id: 't5' } });
    const p = await svc.getKitchenPayload(TENANT, order.id);
    expect(p.items.map((i) => i.name)).toEqual(['Wash', 'Soup']);
    expect(JSON.stringify(p)).not.toMatch(/price|total|"tax"/);
    expect(p.table_name).toBe('T5');
    expect(p.only_unsent).toBe(true);
    const all = await svc.getKitchenPayload(TENANT, order.id, { all: true });
    expect(all.items).toHaveLength(3);
  });
});

describe('PrintService.updateTemplate / uploadLogo guards', () => {
  it('rejects a logo_path from another tenant', async () => {
    const { svc } = build();
    await expect(
      svc.updateTemplate(TENANT, 'u1', 'invoice', {
        logo_path: 'other/print-logo/x/logo.png',
      }),
    ).rejects.toThrow('does not belong');
  });

  it('rejects non-images and oversize files', async () => {
    const { svc } = build();
    const txt = Buffer.from('<svg></svg>');
    await expect(
      svc.uploadLogo(TENANT, 'u1', {
        buffer: txt,
        originalname: 'a.png',
        mimetype: 'image/png',
        size: txt.length,
      }),
    ).rejects.toThrow('PNG, JPEG or WebP');
    const big = Buffer.alloc(1024 * 1024 + 1);
    await expect(
      svc.uploadLogo(TENANT, 'u1', {
        buffer: big,
        originalname: 'a.png',
        mimetype: 'image/png',
        size: big.length,
      }),
    ).rejects.toThrow('1 MB');
  });

  it('detects png/jpeg/webp by magic bytes', () => {
    expect(
      detectImageType(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]),
      ),
    ).toBe('image/png');
    expect(detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(
      'image/jpeg',
    );
    expect(detectImageType(Buffer.from('RIFF0000WEBPVP8 '))).toBe('image/webp');
    expect(detectImageType(Buffer.from('GIF89a......'))).toBeNull();
  });
});
