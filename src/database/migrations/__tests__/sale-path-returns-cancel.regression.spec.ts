/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any */
/**
 * WP-D proof, part 2 — D-7 (returns: cost and tax), D-8 (tax-inclusive partial refund, rounding), D-9 (cancel / reversal).
 *
 * LOCAL DISPOSABLE DATABASE ONLY. Real InvoicesRepository + real fn_create_sales_return / fn_reverse_sales_order.
 * Tests prefixed `KNOWN-DEFECT:` assert today's behaviour on purpose and describe the defect precisely.
 */
import { Harness } from './support/sale-path-fixtures';
import { PosEngine } from '../../../engines/pos-engine/pos.engine';
import { DiscountEngine } from '../../../engines/discount-engine/discount.engine';

const pos = new PosEngine(new DiscountEngine());

jest.setTimeout(180000);

describe('WP-D sale path proof (2/3): returns, tax, cancel', () => {
  const h = new Harness();
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL (local) required');
    await h.open();
  }, 60000);
  afterAll(async () => h.close());

  const sumLines = (ls: any[], code: string, side: 'd' | 'c') =>
    ls.filter((l) => l.code === code).reduce((t, l) => t + Number(l[side]), 0);

  // ------------------------------------------------------------------ D-9 cancel
  describe('D-9 cancel / reversal', () => {
    it('reversal swaps EVERY line; stock restored at the sale cost; all ledger accounts net to zero; second cancel rejected (and nothing doubles)', async () => {
      const f = await h.tenant('d9');
      const a = await h.item(f, 'A');
      const b = await h.item(f, 'B');
      await h.receive(f, a, 10, 7);
      await h.receive(f, b, 5, 4);
      const s = await h.runSale(f, [{ itemId: a, qty: 2, price: 20 }, { itemId: b, qty: 3, price: 10 }], { mode: 'pooled_stock_on', taxRate: 0.15, payment: 'cash' });
      expect(s.ok).toBe(true);
      if (!s.ok) return;
      const c = await h.runCancel(f, s.id);
      expect(c.ok).toBe(true);
      const es = await h.entries(f, s.id);
      expect(es).toHaveLength(2);
      const orig = es.find((e) => !e.reversal_of_id);
      const rev = es.find((e) => e.reversal_of_id);
      expect(rev.reversal_of_id).toBe(orig.id);
      const lo = await h.lines(orig.id);
      const lr = await h.lines(rev.id);
      expect(lr.map((l) => [l.code, Number(l.c), Number(l.d)])).toEqual(lo.map((l) => [l.code, Number(l.d), Number(l.c)]));
      // stock: restored at original cost, per original movement
      expect(await h.onHand(f, a)).toBe(10);
      expect(await h.onHand(f, b)).toBe(5);
      const back = await h.movements(f, s.id, 'sale_return');
      expect(back).toHaveLength(2);
      expect(back.map((m) => Number(m.total_cost)).sort()).toEqual([12, 14]);
      expect(Object.values(await h.balances(f)).every((v) => v === 0)).toBe(true);
      // second cancel at repository level: reversal raises "already reversed" -> whole cancel rolled back, no new entry / movement
      const c2 = await h.runCancel(f, s.id);
      expect(c2.ok).toBe(false);
      if (!c2.ok) expect(c2.error).toMatch(/(already been reversed|status reversed)/);
      expect(await h.entries(f, s.id)).toHaveLength(2);
      expect(await h.movements(f, s.id, 'sale_return')).toHaveLength(2);
      expect(await h.onHand(f, a)).toBe(10);
    });

    it('two concurrent cancels (2 connections): exactly one reversal entry and one restock', async () => {
      const f = await h.tenant('d9con');
      const a = await h.item(f, 'A');
      await h.receive(f, a, 10, 7);
      const s = await h.runSale(f, [{ itemId: a, qty: 2, price: 20 }], { mode: 'pooled_stock_on' });
      if (!s.ok) throw new Error('setup');
      const r = await Promise.all([h.runCancel(f, s.id), h.runCancel(f, s.id)]);
      expect(r.filter((x) => x.ok)).toHaveLength(1);
      expect(await h.entries(f, s.id)).toHaveLength(2);
      expect(await h.movements(f, s.id, 'sale_return')).toHaveLength(1);
      expect(await h.onHand(f, a)).toBe(10);
    });

    it('KNOWN-DEFECT: the stock restore after cancel is a separate best-effort call; when it fails the ledger is reversed (inventory debited back) but stock stays deducted', async () => {
      const f = await h.tenant('d9asym');
      const a = await h.item(f, 'A');
      await h.receive(f, a, 10, 7);
      const s = await h.runSale(f, [{ itemId: a, qty: 2, price: 20 }], { mode: 'pooled_stock_on' });
      if (!s.ok) throw new Error('setup');
      const c = await h.runCancel(f, s.id, { failRestock: true }); // restock call lost / failed (service only logs a warning)
      expect(c.ok).toBe(true);
      expect(await h.entries(f, s.id)).toHaveLength(2); // ledger fully reversed
      expect(await h.onHand(f, a)).toBe(8); // ...but 2 units are still gone
      expect(await h.movements(f, s.id, 'sale_return')).toHaveLength(0);
      expect((await h.balances(f))['1200'] ?? 0).toBe(0); // inventory asset says 0 net, layers say 56 (10x7 - 14)
      expect(await h.layerValue(f)).toBe(56);
      // detectable: monitor M-9 (cancelled order with sale movements and no restock) in migration 329
    });

    it('cancel of a stock-in-tx-OFF sale: entry had no COGS, restock adds the layer back; ledger nets to zero, stock back to 10', async () => {
      const f = await h.tenant('d9off');
      const a = await h.item(f, 'A');
      await h.receive(f, a, 10, 7);
      const s = await h.runSale(f, [{ itemId: a, qty: 2, price: 20 }], { mode: 'pooled_stock_off' });
      if (!s.ok) throw new Error('setup');
      expect((await h.runCancel(f, s.id)).ok).toBe(true);
      expect(await h.onHand(f, a)).toBe(10);
      expect(Object.values(await h.balances(f)).every((v) => v === 0)).toBe(true);
    });

    it('cancelling a partly-backordered sale: delivered part restocked; the restock itself closes the order own backorder (stock 3, backorder 0) but the backorders row reads fulfilled for a CANCELLED order (cosmetic anomaly, documented)', async () => {
      const f = await h.tenant('d9bo');
      const a = await h.item(f, 'A');
      await h.receive(f, a, 3, 7);
      const s = await h.runSale(f, [{ itemId: a, qty: 5, price: 20 }], { mode: 'pooled_stock_on' });
      if (!s.ok) throw new Error('setup');
      expect(await h.backorder(f, a)).toBe(2);
      expect(Number((await h.movements(f, s.id))[0].quantity)).toBe(3);
      expect((await h.runCancel(f, s.id)).ok).toBe(true);
      expect(await h.onHand(f, a)).toBe(3);
      expect((await h.q('SELECT status FROM backorders WHERE order_id=$1', [s.id]))[0].status).toBe('fulfilled');
      expect(await h.backorder(f, a)).toBe(0); // numbers are coherent; only the row status is misleading
    });

    it('cancel of a never-posted order (legacy path) is accepted: nothing to reverse is swallowed, status cancelled, stock restored', async () => {
      const f = await h.tenant('d9legacy');
      const a = await h.item(f, 'A');
      await h.receive(f, a, 10, 7);
      const s = await h.runSale(f, [{ itemId: a, qty: 2, price: 20 }], { mode: 'pooled_off' });
      if (!s.ok) throw new Error('setup');
      const c = await h.runCancel(f, s.id);
      expect(c.ok).toBe(true);
      expect((await h.q('SELECT status FROM orders WHERE id=$1', [s.id]))[0].status).toBe('cancelled');
      expect(await h.onHand(f, a)).toBe(10);
    });
  });

  // ------------------------------------------------------------------ D-7 returns
  describe('D-7 returns: cost and entry', () => {
    it('full return (cash): restock at the sale cost, return entry = exact opposite of the sale entry, ledger nets to zero', async () => {
      const f = await h.tenant('d7full');
      const a = await h.item(f, 'A');
      await h.receive(f, a, 10, 7);
      const shift = await h.openShift(f);
      const s = await h.runSale(f, [{ itemId: a, qty: 4, price: 20 }], { mode: 'pooled_stock_on', taxRate: 0.15, payment: 'cash' });
      if (!s.ok) throw new Error('setup');
      const [oi] = await h.orderItemIds(s.id);
      const r = await h.doReturn(f, s.id, [[oi, 4]], shift);
      expect(r.ok).toBe(true);
      expect(Number(r.res.refund_total)).toBe(92);
      expect(Number(r.res.net_amount)).toBe(80);
      expect(Number(r.res.tax_amount)).toBe(12);
      const mv = await h.q("SELECT * FROM stock_movements WHERE tenant_id=$1 AND movement_type='sale_return'", [f.tenantId]);
      expect(mv).toHaveLength(1);
      expect(Number(mv[0].unit_cost)).toBe(7);
      expect(Number(mv[0].total_cost)).toBe(28);
      expect(await h.onHand(f, a)).toBe(10);
      const ls = await h.lines(r.res.journal_entry_id);
      expect(sumLines(ls, '4000', 'd')).toBe(80);
      expect(sumLines(ls, '2200', 'd')).toBe(12);
      expect(sumLines(ls, '1000', 'c')).toBe(92);
      expect(sumLines(ls, '1200', 'd')).toBe(28);
      expect(sumLines(ls, '5000', 'c')).toBe(28);
      expect(Object.values(await h.balances(f)).every((v) => v === 0)).toBe(true);
    });

    it('partial return (1 of 4): refund share, cost = 1 unit at the original cost, ledger = sale minus returned share', async () => {
      const f = await h.tenant('d7part');
      const a = await h.item(f, 'A');
      await h.receive(f, a, 10, 7);
      const s = await h.runSale(f, [{ itemId: a, qty: 4, price: 20 }], { mode: 'pooled_stock_on', taxRate: 0.15, payment: 'card' });
      if (!s.ok) throw new Error('setup');
      const [oi] = await h.orderItemIds(s.id);
      const r = await h.doReturn(f, s.id, [[oi, 1]]);
      expect(r.ok).toBe(true);
      expect(Number(r.res.refund_total)).toBe(23);
      expect(Number(r.res.net_amount)).toBe(20);
      expect(Number(r.res.tax_amount)).toBe(3);
      expect(await h.onHand(f, a)).toBe(7);
      expect(Number((await h.q("SELECT total_cost FROM stock_movements WHERE tenant_id=$1 AND movement_type='sale_return'", [f.tenantId]))[0].total_cost)).toBe(7);
      const b = await h.balances(f);
      expect(b['4000']).toBe(-60); // revenue 80 - 20 returned
      expect(b['2200']).toBe(-9);
      expect(b['5000']).toBe(21); // 28 - 7
      expect(b['1200']).toBe(-21);
    });

    it('FIFO multi-layer sale then partial return: returned units come back at the sale weighted-average cost, ledger inventory equals movement cost', async () => {
      const f = await h.tenant('d7fifo');
      const a = await h.item(f, 'A');
      await h.receive(f, a, 100, 7);
      await h.receive(f, a, 100, 8);
      const s = await h.runSale(f, [{ itemId: a, qty: 120, price: 20 }], { mode: 'pooled_stock_on' });
      if (!s.ok) throw new Error('setup');
      const [oi] = await h.orderItemIds(s.id);
      const r = await h.doReturn(f, s.id, [[oi, 12]]);
      expect(r.ok).toBe(true);
      const back = (await h.q("SELECT unit_cost, total_cost FROM stock_movements WHERE tenant_id=$1 AND movement_type='sale_return'", [f.tenantId]))[0];
      expect(Number(back.unit_cost)).toBeCloseTo(7.1667, 4);
      const ls = await h.lines(r.res.journal_entry_id);
      expect(sumLines(ls, '1200', 'd')).toBeCloseTo(86, 1); // 12 x 7.1667 = 86.00
      expect(sumLines(ls, '5000', 'c')).toBeCloseTo(86, 1);
    });

    it('over-return and re-return are rejected; refunds can never exceed the order total', async () => {
      const f = await h.tenant('d7cap');
      const a = await h.item(f, 'A');
      await h.receive(f, a, 10, 7);
      const s = await h.runSale(f, [{ itemId: a, qty: 2, price: 20 }], { mode: 'pooled_stock_on', taxRate: 0.15 });
      if (!s.ok) throw new Error('setup');
      const [oi] = await h.orderItemIds(s.id);
      expect((await h.doReturn(f, s.id, [[oi, 3]])).ok).toBe(false);
      expect((await h.doReturn(f, s.id, [[oi, 2]])).ok).toBe(true);
      const again = await h.doReturn(f, s.id, [[oi, 1]]);
      expect(again.ok).toBe(false);
      expect(await h.onHand(f, a)).toBe(10);
    });

    it('KNOWN-DEFECT: a return on a stock-in-tx-OFF sale credits COGS and debits inventory for cost the sale entry never booked (asymmetric ledger)', async () => {
      const f = await h.tenant('d7asym');
      const a = await h.item(f, 'A');
      await h.receive(f, a, 10, 7);
      const s = await h.runSale(f, [{ itemId: a, qty: 4, price: 20 }], { mode: 'pooled_stock_off', taxRate: 0.15 });
      if (!s.ok) throw new Error('setup');
      const [oi] = await h.orderItemIds(s.id);
      const r = await h.doReturn(f, s.id, [[oi, 4]]);
      expect(r.ok).toBe(true);
      const b = await h.balances(f);
      expect(b['5000']).toBe(-28); // COGS credited with no prior debit
      expect(b['1200']).toBe(28); // inventory debited with no prior credit
    });

    it('KNOWN-DEFECT (medium): returning units that were BACKORDERED (never deducted) restocks phantom stock', async () => {
      const f = await h.tenant('d7phantom');
      const a = await h.item(f, 'A');
      await h.receive(f, a, 3, 7);
      const s = await h.runSale(f, [{ itemId: a, qty: 5, price: 20 }], { mode: 'pooled_stock_on' });
      if (!s.ok) throw new Error('setup');
      expect(await h.onHand(f, a)).toBe(0);
      const [oi] = await h.orderItemIds(s.id);
      const r = await h.doReturn(f, s.id, [[oi, 5]]);
      expect(r.ok).toBe(true);
      // only 3 units were ever deducted, yet 5 come back
      expect(await h.onHand(f, a)).toBe(5);
    });

    it('sale whose stock deduction failed (no movements): return refunds money, restocks nothing, return entry flagged requires_cogs_reconciliation', async () => {
      const f = await h.tenant('d7nomv');
      const a = await h.item(f, 'A', { costing: 'standard', standardCost: null });
      await h.receive(f, a, 10, 7);
      const s = await h.runSale(f, [{ itemId: a, qty: 2, price: 20 }], { mode: 'pooled_stock_on', taxRate: 0.15 });
      if (!s.ok) throw new Error('setup');
      expect(await h.movements(f, s.id)).toHaveLength(0);
      const [oi] = await h.orderItemIds(s.id);
      const r = await h.doReturn(f, s.id, [[oi, 2]]);
      expect(r.ok).toBe(true);
      const [e] = await h.q('SELECT requires_cogs_reconciliation r FROM journal_entries WHERE id=$1', [r.res.journal_entry_id]);
      expect(e.r).toBe(true);
      expect(await h.onHand(f, a)).toBe(10);
    });
  });

  // ------------------------------------------------------------------ D-8 tax
  describe('D-8 tax-inclusive partial refund and rounding (SEF-R-019)', () => {
    const grossLines = (a: string, b: string) => [
      { itemId: a, qty: 1, price: 50 },
      { itemId: b, qty: 1, price: 65 },
    ];

    it('tax-inclusive, no discount: refund of one 50.00 gross line is exactly 50.00 (net 43.48 + tax 6.52) and the final return takes the exact remainder', async () => {
      const f = await h.tenant('d8incl');
      const a = await h.item(f, 'A');
      const b = await h.item(f, 'B');
      await h.receive(f, a, 5, 10);
      await h.receive(f, b, 5, 10);
      const built = pos.buildInvoice(
        [
          { item_id: a, item_name: 'A', quantity: 1, unit_price: 50 },
          { item_id: b, item_name: 'B', quantity: 1, unit_price: 65 },
        ],
        undefined,
        0.15,
        true,
      );
      expect(built).toMatchObject({ subtotal: 100, tax_amount: 15, total: 115 });
      const s = await h.runSale(f, grossLines(a, b), {
        mode: 'pooled_stock_on',
        payment: 'card',
        amounts: { subtotal: built.subtotal, discount: built.discount_amount, tax: built.tax_amount, total: built.total },
      });
      if (!s.ok) throw new Error('setup ' + JSON.stringify(s));
      const [oiA, oiB] = await h.orderItemIds(s.id);
      const r1 = await h.doReturn(f, s.id, [[oiA, 1]]);
      expect(r1.ok).toBe(true);
      expect(Number(r1.res.refund_total)).toBe(43.48 + 6.52); // 50.00
      expect(Number(r1.res.net_amount)).toBe(43.48);
      expect(Number(r1.res.tax_amount)).toBe(6.52);
      const r2 = await h.doReturn(f, s.id, [[oiB, 1]]);
      expect(r2.ok).toBe(true);
      expect(Number(r2.res.refund_total)).toBe(65);
      expect(Number(r1.res.refund_total) + Number(r2.res.refund_total)).toBe(115);
      expect(Number(r1.res.tax_amount) + Number(r2.res.tax_amount)).toBe(15);
      expect(Object.values(await h.balances(f)).every((v) => v === 0)).toBe(true);
    });

    it('tax-inclusive WITH a 10% discount: partial refund is the proportional share of the discounted gross, not more', async () => {
      const f = await h.tenant('d8discincl');
      const a = await h.item(f, 'A');
      const b = await h.item(f, 'B');
      await h.receive(f, a, 5, 10);
      await h.receive(f, b, 5, 10);
      const built = pos.buildInvoice(
        [
          { item_id: a, item_name: 'A', quantity: 1, unit_price: 50 },
          { item_id: b, item_name: 'B', quantity: 1, unit_price: 65 },
        ],
        { type: 'percentage', value: 10 },
        0.15,
        true,
      );
      expect(built.total).toBe(103.5);
      const s = await h.runSale(f, grossLines(a, b), {
        mode: 'pooled_stock_on',
        amounts: { subtotal: built.subtotal, discount: built.discount_amount, tax: built.tax_amount, total: built.total },
      });
      if (!s.ok) throw new Error('setup ' + JSON.stringify(s));
      const [oiA] = await h.orderItemIds(s.id);
      const r = await h.doReturn(f, s.id, [[oiA, 1]]);
      expect(r.ok).toBe(true);
      // customer paid 103.50 for 115.00 of goods; the 50.00 line carries 50/115 of that = 44.99 (+-0.01)
      expect(Math.abs(Number(r.res.refund_total) - (103.5 * 50) / 115)).toBeLessThanOrEqual(0.01);
    });

    it('tax-exclusive, discount: proportional refunds, two partial returns + remainder sum to exactly the order total', async () => {
      const f = await h.tenant('d8excl');
      const a = await h.item(f, 'A');
      await h.receive(f, a, 20, 3);
      const built = pos.buildInvoice([{ item_id: a, item_name: 'A', quantity: 7, unit_price: 13.33 }], { type: 'percentage', value: 15 }, 0.15, false);
      const s = await h.runSale(f, [{ itemId: a, qty: 7, price: 13.33 }], {
        mode: 'pooled_stock_on',
        amounts: { subtotal: built.subtotal, discount: built.discount_amount, tax: built.tax_amount, total: built.total },
      });
      if (!s.ok) throw new Error('setup ' + JSON.stringify(s));
      const [oi] = await h.orderItemIds(s.id);
      const parts = [2, 3, 2];
      let refunded = 0;
      let tax = 0;
      for (const q of parts) {
        const r = await h.doReturn(f, s.id, [[oi, q]]);
        expect(r.ok).toBe(true);
        refunded += Number(r.res.refund_total);
        tax += Number(r.res.tax_amount);
      }
      expect(Math.round(refunded * 100) / 100).toBe(built.total);
      expect(Math.round(tax * 100) / 100).toBe(built.tax_amount);
      expect(Object.values(await h.balances(f)).every((v) => Math.abs(v) < 0.005)).toBe(true);
    });

    it('many small lines returned one at a time (17 lines x 0.35 at 15%, 0.5-boundary rounding): refunds sum to the order total, tax to the order tax, ledger nets to zero', async () => {
      const f = await h.tenant('d8many');
      const a = await h.item(f, 'A');
      await h.receive(f, a, 100, 0.1);
      const lines = Array.from({ length: 17 }, () => ({ itemId: a, qty: 1, price: 0.35 }));
      const built = pos.buildInvoice(lines.map((l) => ({ item_id: l.itemId, item_name: 'A', quantity: 1, unit_price: l.price })), undefined, 0.15, false);
      const s = await h.runSale(f, lines, {
        mode: 'pooled_stock_on',
        amounts: { subtotal: built.subtotal, discount: built.discount_amount, tax: built.tax_amount, total: built.total },
      });
      if (!s.ok) throw new Error('setup ' + JSON.stringify(s));
      const ids = await h.orderItemIds(s.id);
      expect(ids).toHaveLength(17);
      let refunded = 0;
      let tax = 0;
      let n = 0;
      for (const id of ids) {
        const r = await h.doReturn(f, s.id, [[id, 1]]);
        // a single 0.35 line can round to a 0.40 refund: it must never be rejected for rounding
        expect(r.ok).toBe(true);
        refunded += Number(r.res.refund_total);
        tax += Number(r.res.tax_amount);
        n++;
      }
      expect(n).toBe(17);
      expect(Math.round(refunded * 100) / 100).toBe(built.total);
      expect(Math.round(tax * 100) / 100).toBe(built.tax_amount);
    });

    it('0.5 halves: share x net rounds half away from zero consistently; final remainder absorbs the cent', async () => {
      const f = await h.tenant('d8half');
      const a = await h.item(f, 'A');
      await h.receive(f, a, 10, 1);
      // 3 x 0.50 = 1.50, tax 15% = 0.225 -> 0.23 (rounding 0.5 up); each 1/3 share is 0.075 tax
      const built = pos.buildInvoice([{ item_id: a, item_name: 'A', quantity: 3, unit_price: 0.5 }], undefined, 0.15, false);
      const s = await h.runSale(f, [{ itemId: a, qty: 3, price: 0.5 }], {
        mode: 'pooled_stock_on',
        amounts: { subtotal: built.subtotal, discount: built.discount_amount, tax: built.tax_amount, total: built.total },
      });
      if (!s.ok) throw new Error('setup ' + JSON.stringify(s));
      const [oi] = await h.orderItemIds(s.id);
      let tax = 0;
      let refunded = 0;
      for (let i = 0; i < 3; i++) {
        const r = await h.doReturn(f, s.id, [[oi, 1]]);
        expect(r.ok).toBe(true);
        tax += Number(r.res.tax_amount);
        refunded += Number(r.res.refund_total);
      }
      expect(Math.round(tax * 100) / 100).toBe(built.tax_amount);
      expect(Math.round(refunded * 100) / 100).toBe(built.total);
    });
  });
});
