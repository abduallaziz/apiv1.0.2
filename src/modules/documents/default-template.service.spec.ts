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
