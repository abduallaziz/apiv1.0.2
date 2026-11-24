import { InvoicesRepository } from './invoices.repository';
import { MetricsService } from '../../../core/metrics/metrics.service';

// WP-E: with the flag off the pooled sale / cancel issue exactly today's statements; with it on they use per-line
// savepoints and the exception recorder, and fall back to today's behaviour when migration 335 is missing.
describe('InvoicesRepository WP-E exception recording (unit)', () => {
  const tenant = { tenantId: 't1' } as never;
  const orderPayload = { branch_id: 'b1', cashier_id: 'c1', status: 'completed', subtotal: 1, discount: 0, tax: 0, total: 1, payment_method: 'cash', sale_attempt_id: 's1' };
  const items = [
    { item_id: 'i1', item_name: 'a', quantity: 1, unit_price: 1, official_price_snapshot: 1 },
    { item_id: 'i2', item_name: 'b', quantity: 1, unit_price: 1, official_price_snapshot: 1 },
  ];

  function build(fail: (sql: string, params: unknown[]) => Error | undefined) {
    const calls: string[] = [];
    const client = {
      query: jest.fn((sql: string, params: unknown[] = []) => {
        calls.push(sql.trim().split(/\s+/).slice(0, 3).join(' '));
        const err = fail(sql, params);
        if (err) return Promise.reject(err);
        if (sql.includes('INSERT INTO orders')) return Promise.resolve({ rows: [{ id: 'o1' }] });
        if (sql.includes('INSERT INTO order_items')) return Promise.resolve({ rows: [{ id: 'oi' }] });
        return Promise.resolve({ rows: [] });
      }),
    };
    const session = { runInTenantContext: (_t: unknown, fn: (c: unknown) => unknown) => fn(client) };
    return { repo: new InvoicesRepository({} as never, session as never), calls };
  }

  it('flag off: whole-order savepoint only, no per-line statements, result has no stockExceptions key', async () => {
    const { repo, calls } = build((sql) => (sql.includes('fn_process_sale_stock_deduction') ? new Error('boom') : undefined));
    const res = await repo.createWithItemsPooled(tenant, orderPayload, items, { warehouseId: 'w1' });
    expect(res).toEqual({ id: 'o1', invoice_no: null, stockDeducted: false, stockError: 'boom' });
    expect('stockExceptions' in res).toBe(false);
    expect(calls.some((c) => c.includes('fn_process_sale_stock_deduction_line') || c.includes('fn_record_financial_exception'))).toBe(false);
    expect(calls.filter((c) => c.startsWith('SAVEPOINT'))).toHaveLength(1);
  });

  it('flag on: failing line is rolled back to its own savepoint and recorded; the other line stays; sale proceeds', async () => {
    const { repo, calls } = build((sql, p) => (sql.includes('_line(') && p[4] === 'i2' ? new Error('line boom') : undefined));
    const res = await repo.createWithItemsPooled(tenant, orderPayload, items, { warehouseId: 'w1', recordExceptions: true });
    expect(res).toMatchObject({ id: 'o1', stockDeducted: false, stockExceptions: 1, stockError: 'line boom' });
    expect(calls.filter((c) => c.includes('fn_record_financial_exception'))).toHaveLength(1);
    expect(calls.filter((c) => c.includes('fn_post_sales_order'))).toHaveLength(1);
  });

  it('flag on but recording itself fails (migration 335 missing): falls back to the original behaviour, sale not lost', async () => {
    const { repo, calls } = build((sql) => (sql.includes('fn_process_sale_stock_deduction_line') || sql.includes('fn_record_financial_exception') ? new Error('function does not exist') : undefined));
    const res = await repo.createWithItemsPooled(tenant, orderPayload, items, { warehouseId: 'w1', recordExceptions: true });
    expect(res).toMatchObject({ id: 'o1', stockDeducted: false });
    expect('stockExceptions' in res).toBe(false);
    expect(calls.filter((c) => c.includes('fn_post_sales_order'))).toHaveLength(1);
  });

  it('metrics: counter is labelled by kind only', async () => {
    const m = new MetricsService();
    m.recordFinancialException('stock_deduction_failed', 2);
    const text = await m.getMetrics();
    expect(text).toMatch(/sefay_financial_exceptions_recorded_total{kind="stock_deduction_failed",app="sefay-api"} 2/);
    expect(text).not.toMatch(/sefay_financial_exceptions_recorded_total\{[^}]*tenant/);
  });
});
