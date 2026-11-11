import { buildZatcaQrBase64, tlvField } from './zatca-qr.util';

describe('buildZatcaQrBase64', () => {
  it('matches the published ZATCA sample vector', () => {
    expect(
      buildZatcaQrBase64({
        sellerName: 'Bobs Records',
        vatNumber: '310122393500003',
        timestamp: '2022-04-25T15:30:00Z',
        totalWithVat: 1000,
        vatAmount: 150,
      }),
    ).toBe(
      'AQxCb2JzIFJlY29yZHMCDzMxMDEyMjM5MzUwMDAwMwMUMjAyMi0wNC0yNVQxNTozMDowMFoEBzEwMDAuMDAFBjE1MC4wMA==',
    );
  });

  it('encodes Arabic seller names as UTF-8 with a byte length', () => {
    const name = 'مغسلة';
    const b = Buffer.from(
      buildZatcaQrBase64({
        sellerName: name,
        vatNumber: '300000000000003',
        timestamp: new Date('2026-01-01T10:00:00Z'),
        totalWithVat: 28.75,
        vatAmount: 3.75,
      }),
      'base64',
    );
    expect(b[0]).toBe(1);
    expect(b[1]).toBe(Buffer.byteLength(name, 'utf8'));
    expect(b.subarray(2, 2 + b[1]).toString('utf8')).toBe(name);
    expect(b.toString('utf8')).toContain('28.75');
    expect(b.toString('utf8')).toContain('3.75');
  });

  it('rejects a field longer than 255 bytes', () => {
    expect(() => tlvField(1, 'x'.repeat(256))).toThrow(RangeError);
  });
});
