import jsQR from 'jsqr';
import {
  isSafeHttpsUrl,
  minQrSizeMm,
  qrGeometryProblem,
  qrSvg,
} from './qr.util';
import { buildZatcaQrBase64 } from '../print/zatca-qr.util';
import { TemplateRenderService } from './template-render.service';

/** Rasterises the printed SVG (what actually reaches the PDF) and decodes it like a scanner would. */
function decodeSvg(svg: string): string | null {
  const total = Number(/viewBox="0 0 (\d+) /.exec(svg)?.[1]);
  const d = /<path d="([^"]+)"/.exec(svg)?.[1] ?? '';
  const scale = 8;
  const px = total * scale;
  const data = new Uint8ClampedArray(px * px * 4).fill(255); // white, opaque
  for (const m of d.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) {
    const x0 = Number(m[1]) * scale;
    const y0 = Number(m[2]) * scale;
    for (let y = y0; y < y0 + scale; y++) {
      for (let x = x0; x < x0 + scale; x++) {
        const i = (y * px + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = 0;
      }
    }
  }
  return jsQR(data, px, px)?.data ?? null;
}

describe('qr.util', () => {
  it('produces a scannable code for a verification URL', () => {
    const url =
      'https://app.example.com/ar/public/verify/AbCdEfGhIjKlMnOpQrStUvWxYz012345';
    expect(decodeSvg(qrSvg(url).svg)).toBe(url);
  });

  it('produces a scannable ZATCA TLV payload (reuses the ZATCA util)', () => {
    const tlv = buildZatcaQrBase64({
      sellerName: 'Sample Seller',
      vatNumber: '300000000000003',
      timestamp: '2026-01-15T10:00:00Z',
      totalWithVat: 460,
      vatAmount: 60,
    });
    expect(decodeSvg(qrSvg(tlv).svg)).toBe(tlv);
  });

  it('includes the 4-module quiet zone', () => {
    const { svg, modules } = qrSvg('hello');
    expect(svg).toContain(`viewBox="0 0 ${modules + 8} ${modules + 8}"`);
  });

  it('guards size, squareness and opacity', () => {
    expect(
      qrGeometryProblem('verification', { width: 30, height: 30 }, 1),
    ).toBeNull();
    expect(
      qrGeometryProblem('verification', { width: 5, height: 5 }, 1),
    ).toMatch(/too small/);
    expect(
      qrGeometryProblem('verification', { width: 30, height: 20 }, 1),
    ).toMatch(/square/);
    expect(
      qrGeometryProblem('verification', { width: 30, height: 30 }, 0.5),
    ).toMatch(/opacity/);
    // ZATCA payloads are denser, so they need more room than a short verification URL
    expect(minQrSizeMm('zatca')).toBeGreaterThan(minQrSizeMm('verification'));
  });

  it('a longer custom URL needs a bigger code', () => {
    const short = 'https://a.co/x';
    const long = 'https://example.com/' + 'a'.repeat(300);
    expect(minQrSizeMm('custom_url', long)).toBeGreaterThan(
      minQrSizeMm('custom_url', short),
    );
  });

  it('only accepts plain https URLs', () => {
    expect(isSafeHttpsUrl('https://example.com/pay?id=1')).toBe(true);
    for (const bad of [
      'http://example.com',
      'javascript:alert(1)',
      'https://u:p@example.com',
      '',
      'not a url',
      'data:text/html,x',
    ]) {
      expect(isSafeHttpsUrl(bad)).toBe(false);
    }
    expect(isSafeHttpsUrl('https://example.com/' + 'a'.repeat(600))).toBe(
      false,
    );
  });
});

describe('QR in the render engine', () => {
  const svc = new TemplateRenderService();
  const base = {
    paper: 'A4',
    orientation: 'portrait',
    direction: 'rtl' as 'rtl' | 'ltr',
    data: {},
    assetUrls: {},
  };
  const qrEl = (
    config: Record<string, unknown>,
    over: Record<string, unknown> = {},
  ) => ({
    id: 'q1',
    type: 'qr',
    config,
    position: { x: 10, y: 10 },
    size: { width: 30, height: 30 },
    ...over,
  });
  const svgOf = (html: string) => /<svg[\s\S]*?<\/svg>/.exec(html)?.[0] ?? '';

  it('draws the backend-provided verification URL as a decodable QR', () => {
    const url = 'https://app.example.com/ar/public/verify/TOKEN';
    const html = svc.render({
      ...base,
      body: { elements: [qrEl({ kind: 'verification' })] },
      qr: { verificationUrl: url },
    });
    expect(decodeSvg(svgOf(html))).toBe(url);
    expect(html).toContain('left:10mm;top:10mm;width:30mm;height:30mm');
  });

  it('draws nothing when the backend has no content yet (never a wrong code)', () => {
    const html = svc.render({
      ...base,
      body: { elements: [qrEl({ kind: 'zatca' })] },
    });
    expect(html).not.toContain('<svg');
  });

  it('refuses an unsafe custom URL at render time too', () => {
    const html = svc.render({
      ...base,
      body: {
        elements: [qrEl({ kind: 'custom_url', url: 'javascript:alert(1)' })],
      },
    });
    expect(html).not.toContain('<svg');
  });

  it('warns when a QR is too small to scan', () => {
    const warnings: string[] = [];
    svc.render({
      ...base,
      body: {
        elements: [
          qrEl({ kind: 'verification' }, { size: { width: 8, height: 8 } }),
        ],
      },
      qr: { verificationUrl: 'https://app.example.com/ar/public/verify/TOKEN' },
      warnings,
    });
    expect(warnings[0]).toMatch(/too small/);
  });

  it('signature_qr is always the verification QR', () => {
    const url = 'https://app.example.com/ar/public/verify/SIGTOKEN';
    const html = svc.render({
      ...base,
      body: { elements: [qrEl({}, { type: 'signature_qr' })] },
      qr: { verificationUrl: url },
    });
    expect(decodeSvg(svgOf(html))).toBe(url);
  });
});
