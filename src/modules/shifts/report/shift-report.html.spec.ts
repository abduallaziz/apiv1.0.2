import { buildShiftReportHtml, ReportLabels } from './shift-report.html';
import { I18nService } from '../../../core/i18n/i18n.service';
import * as arLabels from '../../../core/i18n/locales/ar/shift_report.json';
import * as enLabels from '../../../core/i18n/locales/en/shift_report.json';
import { ShiftEngine } from '../../../engines/shift-engine/shift.engine';

const i18n = new I18nService();
const labels = (lang: 'ar' | 'en') =>
  i18n.bundle('shift_report', lang) as unknown as ReportLabels;

// Flattened key paths of a JSON object (methods.cash, ...).
const keyPaths = (o: unknown, prefix = ''): string[] =>
  Object.entries(o as Record<string, unknown>).flatMap(([k, v]) =>
    v && typeof v === 'object'
      ? keyPaths(v, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  );

describe('shift_report language files', () => {
  it('Arabic and English have exactly the same keys', () => {
    const strip = (o: object) => {
      const { default: _d, ...rest } = o as Record<string, unknown>;
      return rest;
    };
    expect(keyPaths(strip(arLabels)).sort()).toEqual(
      keyPaths(strip(enLabels)).sort(),
    );
  });
});

describe('buildShiftReportHtml', () => {
  const engine = new ShiftEngine();
  const summary = engine.buildShiftSummary({
    openingCash: 100,
    closingCash: 0,
    invoices: [
      { total: 28.75, payment_method: 'cash' },
      { total: 5.75, payment_method: 'mada' },
    ],
    expenses: [],
  });
  const report = engine.buildCloseReport({
    summary,
    counts: { cash: 128.75, mada: 5.75 },
    shift: {
      id: 's1',
      opened_at: '2026-11-08T14:00:00.000Z',
      closed_at: '2026-11-08T21:05:00.000Z',
      cashier_id: 'u1',
      cashier_name: 'عبدالعزيز <b>x</b>',
      branch_id: 'b1',
      branch_name: 'Main & Co',
      notes: 'ok "quoted"',
    },
    itemsCount: 3,
    discountTotal: 0,
    taxTotal: 4.5,
    cancelled: { count: 0, amount: 0 },
  });

  it('Arabic report is RTL with Arabic labels', () => {
    const html = buildShiftReportHtml(report, 'ar', 'SAR', 'Asia/Riyadh', labels('ar'));
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('تقرير إغلاق الصندوق');
    expect(html).toContain('المتوقع');
  });

  it('English report is LTR with English labels', () => {
    const html = buildShiftReportHtml(report, 'en', 'SAR', 'Asia/Riyadh', labels('en'));
    expect(html).toContain('dir="ltr"');
    expect(html).toContain('Register Close Report');
  });

  it('escapes names and notes (no HTML injection)', () => {
    const html = buildShiftReportHtml(report, 'en', 'SAR', 'Asia/Riyadh', labels('en'));
    expect(html).not.toContain('<b>x</b>');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).toContain('Main &amp; Co');
    expect(html).toContain('ok &quot;quoted&quot;');
  });

  it('uses English numerals only (no Arabic-Indic digits)', () => {
    const html = buildShiftReportHtml(report, 'ar', 'SAR', 'Asia/Riyadh', labels('ar'));
    expect(/[٠-٩۰-۹]/.test(html)).toBe(false);
    expect(html).toContain('34.50'); // total sales 28.75 + 5.75
  });

  it('shows dates in the tenant timezone (14:00Z = 17:00 Riyadh)', () => {
    const html = buildShiftReportHtml(report, 'en', 'SAR', 'Asia/Riyadh', labels('en'));
    expect(html).toContain('17:00');
  });

  it('marks a legacy report', () => {
    const legacy = { ...report, legacy: true };
    expect(buildShiftReportHtml(legacy, 'en', 'SAR', 'UTC', labels('en'))).toContain(
      'Older register',
    );
  });
});
