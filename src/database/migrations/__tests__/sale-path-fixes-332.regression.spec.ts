/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any */
/**
 * FIX 332 (WP-D D-8 / SEF-R-019) — tax-inclusive partial refund.
 * Proves BEFORE (rollback applied: the defect) and AFTER (332 applied: correct), the rollback body == the 328 body,
 * and that re-applying is idempotent. LOCAL DISPOSABLE DATABASE ONLY; leaves 332 applied (the state apply.js produces).
 */
import * as fs from 'fs';
import * as path from 'path';
import { Harness } from './support/sale-path-fixtures';
import { PosEngine } from '../../../engines/pos-engine/pos.engine';
import { DiscountEngine } from '../../../engines/discount-engine/discount.engine';

jest.setTimeout(180000);
const PENDING = path.resolve(__dirname, '..', '..', 'migrations_pending');
const read = (...p: string[]) => fs.readFileSync(path.join(PENDING, ...p), 'utf8').replace(/\r/g, '');
const pos = new PosEngine(new DiscountEngine());

describe('FIX 332: tax-inclusive partial return share (before / after / rollback)', () => {
  const h = new Harness();
  const hash = async () =>
    (await h.q("SELECT md5(replace(prosrc, chr(13), '')) h FROM pg_proc WHERE proname='fn_create_sales_return' AND pronamespace='public'::regnamespace"))[0].h as string;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL (local) required');
    await h.open();
    await h.ensurePending('332_sales_return_tax_inclusive_share.sql');
  }, 120000);
  afterAll(async () => {
    await h.pg.query(read('332_sales_return_tax_inclusive_share.sql')); // leave fixed
    await h.close();
  });

  async function twoLineInclusiveSale(label: string, discountPct?: number) {
    const f = await h.tenant(label);
    const a = await h.item(f, 'A');
    const b = await h.item(f, 'B');
    await h.receive(f, a, 5, 10);
    await h.receive(f, b, 5, 10);
    const built = pos.buildInvoice(
      [
        { item_id: a, item_name: 'A', quantity: 1, unit_price: 50 },
        { item_id: b, item_name: 'B', quantity: 1, unit_price: 65 },
      ],
      discountPct ? { type: 'percentage', value: discountPct } : undefined,
      0.15,
      true,
    );
    const s = await h.runSale(
      f,
      [
        { itemId: a, qty: 1, price: 50 },
        { itemId: b, qty: 1, price: 65 },
      ],
      { mode: 'pooled_stock_on', amounts: { subtotal: built.subtotal, discount: built.discount_amount, tax: built.tax_amount, total: built.total } },
    );
    if (!s.ok) throw new Error('setup');
    return { f, built, orderId: s.id, items: await h.orderItemIds(s.id) };
  }

  it('rollback body is byte-identical to the 328 body of fn_create_sales_return', async () => {
    const m = /AS \$function\$([\s\S]*?)\$function\$/.exec(read('328_posting_date_policy_wiring.sql').slice(read('328_posting_date_policy_wiring.sql').indexOf('FUNCTION public.fn_create_sales_return')));
    const b328 = require('crypto').createHash('md5').update(m![1]).digest('hex');
    const fixedHash = await hash();
    await h.pg.query(read('rollback', '332_sales_return_tax_inclusive_share_ROLLBACK.sql'));
    expect(await hash()).toBe(b328);
    expect(await hash()).not.toBe(fixedHash);
    await h.pg.query(read('332_sales_return_tax_inclusive_share.sql'));
    expect(await hash()).toBe(fixedHash); // idempotent re-apply
    await h.pg.query(read('332_sales_return_tax_inclusive_share.sql'));
    expect(await hash()).toBe(fixedHash);
  });

  it('BEFORE (rollback applied): returning the 50.00 gross line of a 115.00 inclusive order refunds 57.50 (defect), later refund squeezed', async () => {
    await h.pg.query(read('rollback', '332_sales_return_tax_inclusive_share_ROLLBACK.sql'));
    const { f, orderId, items } = await twoLineInclusiveSale('f332before');
    const r = await h.doReturn(f, orderId, [[items[0], 1]]);
    expect(r.ok).toBe(true);
    expect(Number(r.res.refund_total)).toBe(57.5); // customer paid 50.00 for this line
    const r2 = await h.doReturn(f, orderId, [[items[1], 1]]);
    expect(r2.ok).toBe(true);
    expect(Number(r2.res.refund_total)).toBe(57.5); // 65.00 line refunded only 57.50: remainder rule hides the error in total
  });

  it('AFTER (332 applied): exact gross line value, net/tax split proportional, totals reconcile; discounted order proportional', async () => {
    await h.pg.query(read('332_sales_return_tax_inclusive_share.sql'));
    const a = await twoLineInclusiveSale('f332after');
    const r1 = await h.doReturn(a.f, a.orderId, [[a.items[0], 1]]);
    expect(Number(r1.res.refund_total)).toBe(50);
    expect(Number(r1.res.net_amount)).toBe(43.48);
    expect(Number(r1.res.tax_amount)).toBe(6.52);
    const r2 = await h.doReturn(a.f, a.orderId, [[a.items[1], 1]]);
    expect(Number(r2.res.refund_total)).toBe(65);

    const d = await twoLineInclusiveSale('f332disc', 10);
    expect(d.built.total).toBe(103.5);
    const rd = await h.doReturn(d.f, d.orderId, [[d.items[0], 1]]);
    expect(Math.abs(Number(rd.res.refund_total) - (103.5 * 50) / 115)).toBeLessThanOrEqual(0.01);
  });

  it('tax-EXCLUSIVE orders are unchanged by 332 (sum of lines == subtotal)', async () => {
    const f = await h.tenant('f332excl');
    const a = await h.item(f, 'A');
    await h.receive(f, a, 5, 10);
    const s = await h.runSale(f, [{ itemId: a, qty: 4, price: 20 }], { mode: 'pooled_stock_on', taxRate: 0.15 });
    if (!s.ok) throw new Error('setup');
    const [oi] = await h.orderItemIds(s.id);
    const r = await h.doReturn(f, s.id, [[oi, 1]]);
    expect(Number(r.res.refund_total)).toBe(23);
  });
});
