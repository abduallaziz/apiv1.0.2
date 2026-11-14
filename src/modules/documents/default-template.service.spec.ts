import { DefaultTemplateService } from './default-template.service';
import { defaultQuotationBody } from './default-template.service';
import { sanitizeBody } from './template-body.util';

const ids = {
  corner: '11111111-1111-4111-8111-111111111111',
  skyline: '22222222-2222-4222-8222-222222222222',
  deco: '33333333-3333-4333-8333-333333333333',
  frame: '44444444-4444-4444-8444-444444444444',
  logo: '55555555-5555-4555-8555-555555555555',
};

describe('default quotation templates', () => {
  it.each(['ar', 'en'] as const)(
    '%s body passes the template validator',
    (lang) => {
      expect(() => sanitizeBody(defaultQuotationBody(ids, lang))).not.toThrow();
    },
  );

  it.each(['ar', 'en'] as const)(
    '%s body carries no brand, stamp or signature',
    (lang) => {
      const json = JSON.stringify(defaultQuotationBody(ids, lang));
      expect(json).not.toMatch(/صفاي|sefay/i);
      const types = (
        defaultQuotationBody(ids, lang).elements as Array<{ type: string }>
      ).map((e) => e.type);
      expect(types).not.toContain('stamp');
      expect(types).not.toContain('signature');
    },
  );

  it('the English template is written in English and keeps the contact block off the logo side', () => {
    const body = defaultQuotationBody(ids, 'en');
    const text = JSON.stringify(body);
    expect(text).toContain('Terms & Conditions');
    const contact = (
      body.elements as Array<{ id: string; layout?: { place?: string } }>
    ).find((e) => e.id === 'contact');
    expect(contact?.layout?.place).toBe('start');
  });
});

describe('DefaultTemplateService.restore', () => {
  const make = (liveRows: number) => {
    const query = jest
      .fn()
      .mockResolvedValue({ rows: Array(liveRows).fill({}) });
    const tenantSession = {
      runInTenantContext: jest.fn((_t: unknown, fn: (c: unknown) => unknown) =>
        fn({ query }),
      ),
    };
    const assets = { create: jest.fn().mockResolvedValue({ id: 'a' }) };
    const templates = {
      create: jest.fn().mockResolvedValue({ id: 't' }),
      publish: jest.fn(),
      setDefault: jest.fn(),
    };
    const svc = new DefaultTemplateService(
      tenantSession as never,
      assets as never,
      templates as never,
    );
    return { svc, query, templates };
  };

  it('does nothing while the tenant still has live templates', async () => {
    const { svc, templates, query } = make(1);
    expect(await svc.restore({ tenantId: 't1' } as never, 'u')).toBe(false);
    expect(templates.create).not.toHaveBeenCalled();
    expect(query.mock.calls[0][0]).toContain('deleted_at IS NULL');
  });

  it('re-creates the Arabic and English templates when none are left', async () => {
    const { svc, templates } = make(0);
    expect(await svc.restore({ tenantId: 't1' } as never, 'u')).toBe(true);
    expect(templates.create).toHaveBeenCalledTimes(2);
    expect(templates.setDefault).toHaveBeenCalledTimes(1);
  });
});
