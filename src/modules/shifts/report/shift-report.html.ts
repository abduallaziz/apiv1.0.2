import { CloseReport } from '../../../engines/shift-engine/shift.engine';

// HTML template of the register close report. It is rendered to a real PDF
// by headless Chrome (puppeteer-core), which does the Arabic shaping and
// bidi ordering. Numbers are always English numerals (permanent project
// rule): toFixed / en-GB date parts never localise digits.

export type ReportLang = 'ar' | 'en';

// Every user-facing label comes from the language files
// (core/i18n/locales/{ar,en}/shift_report.json via I18nService.bundle) -
// nothing in this template is hardcoded text.
export interface ReportLabels {
  title: string;
  revision: string;
  legacy_note: string;
  branch: string;
  cashier: string;
  opened_at: string;
  closed_at: string;
  invoices: string;
  items: string;
  total_sales: string;
  discounts: string;
  tax: string;
  expenses: string;
  cancelled: string;
  returned: string;
  opening_cash: string;
  method: string;
  sales: string;
  returns_col: string;
  expected: string;
  counted: string;
  difference: string;
  notes: string;
  methods: Record<string, string>;
}

export const esc = (v: string | null | undefined): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export function formatReportDate(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'short',
      timeStyle: 'short',
      hourCycle: 'h23',
      timeZone,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

const ltr = (v: string) => `<span dir="ltr">${v}</span>`;

const money = (n: number, currency: string) =>
  ltr(`${n.toFixed(2)} ${esc(currency)}`);

const signed = (n: number | null): string => {
  if (n === null) return '—';
  if (n === 0) return '0.00';
  return `${n > 0 ? '+' : '-'}${Math.abs(n).toFixed(2)}`;
};

const diffColor = (n: number | null): string => {
  if (n === null || n === 0) return '#047857';
  return n > 0 ? '#b45309' : '#dc2626';
};

export function buildShiftReportHtml(
  report: CloseReport,
  lang: ReportLang,
  currency: string,
  timeZone: string,
  L: ReportLabels,
): string {
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const end = lang === 'ar' ? 'left' : 'right';
  const start = lang === 'ar' ? 'right' : 'left';
  const s = report.shift;
  const t = report.totals;

  const kv = (label: string, value: string) =>
    `<tr><td class="k">${esc(label)}</td><td class="v">${value}</td></tr>`;

  const methodRows = report.methods
    .map(
      (m) =>
        `<tr>` +
        `<td class="m">${esc(L.methods[m.method] ?? m.method)}</td>` +
        `<td class="n">${m.sales.toFixed(2)}</td>` +
        `<td class="n">${m.returns.toFixed(2)}</td>` +
        `<td class="n">${m.expected.toFixed(2)}</td>` +
        `<td class="n">${m.counted === null ? '—' : m.counted.toFixed(2)}</td>` +
        `<td class="n" style="font-weight:700;color:${diffColor(m.difference)}">${signed(m.difference)}</td>` +
        `</tr>`,
    )
    .join('');

  return `<!doctype html>
<html lang="${lang}" dir="${dir}">
<head>
<meta charset="utf-8">
<style>
  @page { margin: 0; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 0; background: #fff; color: #0f172a;
    font-family: 'Noto Naskh Arabic','Noto Sans Arabic','Segoe UI',Tahoma,Arial,Helvetica,sans-serif;
    font-size: 13px;
  }
  .page { width: 105mm; padding: 6mm; }
  h1 { font-size: 17px; margin: 0; text-align: center; }
  .sub { text-align: center; font-size: 11px; color: #64748b; margin: 2px 0 8px; }
  table { width: 100%; border-collapse: collapse; }
  td.k { padding: 3px 0; color: #475569; text-align: ${start}; }
  td.v { padding: 3px 0; font-weight: 600; text-align: ${end}; }
  hr { border: none; border-top: 1px dashed #cbd5e1; margin: 8px 0; }
  table.methods { font-size: 11px; }
  table.methods th { padding: 4px 2px; font-size: 11px; color: #64748b; font-weight: 600; text-align: ${end}; }
  table.methods th:first-child { text-align: ${start}; }
  table.methods td { padding: 5px 2px; border-top: 1px solid #e2e8f0; }
  td.m { font-weight: 600; text-align: ${start}; }
  td.n { text-align: ${end}; direction: ltr; unicode-bidi: plaintext; }
  .notes { margin-top: 8px; font-size: 12px; color: #475569; }
</style>
</head>
<body>
<div class="page">
  <h1>${esc(L.title)}</h1>
  <div class="sub">${esc(L.revision)} ${report.revision}${report.legacy ? ' · ' + esc(L.legacy_note) : ''}</div>
  <table>
    ${kv(L.branch, esc(s.branch_name))}
    ${kv(L.cashier, esc(s.cashier_name))}
    ${kv(L.opened_at, ltr(esc(formatReportDate(s.opened_at, timeZone))))}
    ${kv(L.closed_at, ltr(esc(formatReportDate(s.closed_at, timeZone))))}
  </table>
  <hr>
  <table>
    ${kv(L.invoices, String(t.invoice_count))}
    ${kv(L.items, String(t.items_count))}
    ${kv(L.total_sales, money(t.total_sales, currency))}
    ${kv(L.discounts, money(t.discount_total, currency))}
    ${kv(L.tax, money(t.tax_total, currency))}
    ${kv(L.expenses, money(t.expenses_total, currency))}
    ${kv(L.cancelled, `${t.cancelled_count} · ${money(t.cancelled_amount, currency)}`)}
    ${kv(L.returned, `${t.returned_count} · ${money(t.returned_amount, currency)}`)}
    ${kv(L.opening_cash, money(report.cash.opening, currency))}
  </table>
  <hr>
  <table class="methods">
    <thead><tr>
      <th>${esc(L.method)}</th><th>${esc(L.sales)}</th><th>${esc(L.returns_col)}</th><th>${esc(L.expected)}</th><th>${esc(L.counted)}</th><th>${esc(L.difference)}</th>
    </tr></thead>
    <tbody>${methodRows}</tbody>
  </table>
  ${s.notes ? `<div class="notes"><b>${esc(L.notes)}:</b> ${esc(s.notes)}</div>` : ''}
</div>
</body>
</html>`;
}
