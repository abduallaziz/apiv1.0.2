/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any */
/**
 * WP-D proof, part 1 — D-1 (flag matrix), D-2 (failure injection), D-3/D-4 (retry / replay / concurrency),
 * D-5/D-6 (historical COGS immutability, FIFO / standard cost).
 *
 * LOCAL DISPOSABLE DATABASE ONLY. Drives the REAL InvoicesRepository against a real Postgres (see support/sale-path-fixtures.ts).
 * Tests named `KNOWN-DEFECT:` assert TODAY's behaviour on purpose; each carries the precise description of why it is a defect.
 * When a defect is fixed (migrations_pending/332_*), the corresponding test lives in sale-path-idempotency-332.regression.spec.ts.
 */
import { Harness, Fx } from './support/sale-path-fixtures';
import { randomUUID } from 'crypto';

jest.setTimeout(180000);

describe('WP-D sale path proof (1/3): matrix, failure injection, retry, COGS immutability', () => {
  const h = new Harness();
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL (local) required');
    await h.open();
  }, 60000);
  afterAll(async () => h.close());

  // ------------------------------------------------------------------ D-1 flag matrix
  describe('D-1 flag matrix: sale -> one order, N sale movements, one balanced entry', () => {
    it('pooled ON + stock-in-tx ON: order, N movements, ONE balanced entry carrying COGS == sum(movement cost); stock levels and layers match', async () => {
      const f = await h.tenant('d1-both');
      const a = await h.item(f, 'A');
      const b = await h.item(f, 'B');
      const c = await h.item(f, 'C-untracked', { tracked: false });
      await h.receive(f, a, 10, 7);
      await h.receive(f, b, 5, 4);
      const s = await h.runSale(
        f,
        [
          { itemId: a, qty: 2, price: 20 },
          { itemId: b, qty: 3, price: 10 },
          { itemId: c, qty: 1, price: 5 },
        ],
        { mode: 'pooled_stock_on', taxRate: 0.15 },
      );
      expect(s.ok).toBe(true);
      if (!s.ok) return;
      expect(s.stockDeducted).toBe(true);
      expect(await h.count('orders', f)).toBe(1);
      const mv = await h.movements(f, s.id);
      expect(mv).toHaveLength(2); // untracked line has no movement
      const mvCost = mv.reduce((t, m) => t + Number(m.total_cost), 0);
      expect(mvCost).toBe(2 * 7 + 3 * 4);
      const es = await h.entries(f, s.id);
      expect(es).toHaveLength(1);
      expect(es[0].requires_cogs_reconciliation).toBe(false);
      expect(await h.entryBalanced(es[0].id)).toBe(true);
      const ls = await h.lines(es[0].id);
      const cogs = ls.find((l) => l.code === '5000');
      const inv = ls.find((l) => l.code === '1200');
      expect(Number(cogs.d)).toBe(mvCost);
      expect(Number(inv.c)).toBe(mvCost);
      // subtotal 40+30+5 = 75, tax 11.25, total 86.25 -> bank (card)
      expect(Number(ls.find((l) => l.code === '4000').c)).toBe(75);
      expect(Number(ls.find((l) => l.code === '2200').c)).toBe(11.25);
      expect(Number(ls.find((l) => l.code === '1010').d)).toBe(86.25);
      expect(await h.onHand(f, a)).toBe(8);
      expect(await h.onHand(f, b)).toBe(2);
      expect((await h.layers(f, a))[0].rem).toBe(8);
      // ledger inventory credit equals layer consumption value
      expect(Number(inv.c)).toBe(2 * 7 + 3 * 4);
    });

    it('pooled ON + stock-in-tx OFF: entry is posted BEFORE stock exists -> revenue-only entry flagged requires_cogs_reconciliation; movement created after commit', async () => {
      const f = await h.tenant('d1-stockoff');
      const a = await h.item(f, 'A');
      await h.receive(f, a, 10, 7);
      const s = await h.runSale(f, [{ itemId: a, qty: 2, price: 20 }], { mode: 'pooled_stock_off' });
      expect(s.ok && s.stockDeducted).toBe(true);
      if (!s.ok) return;
      const mv = await h.movements(f, s.id);
      expect(mv).toHaveLength(1);
      const es = await h.entries(f, s.id);
      expect(es).toHaveLength(1);
      // KNOWN-DEFECT (by design of the flag): COGS is NEVER posted on this configuration. The entry has no 5000/1200 lines
      // although the stock movement (cost 14) exists, so the inventory asset account is overstated by every sale.
      const ls = await h.lines(es[0].id);
      expect(ls.find((l) => l.code === '5000')).toBeUndefined();
      expect(es[0].requires_cogs_reconciliation).toBe(true); // detected by monitor M-2
    });

    it('pooled OFF (legacy path): order + movement exist, NO journal entry at all (KNOWN-DEFECT, decision D-01: retire this path)', async () => {
      const f = await h.tenant('d1-off');
      const a = await h.item(f, 'A');
      await h.receive(f, a, 10, 7);
      const s = await h.runSale(f, [{ itemId: a, qty: 2, price: 20 }], { mode: 'pooled_off' });
      expect(s.ok && s.stockDeducted).toBe(true);
      if (!s.ok) return;
      expect(await h.movements(f, s.id)).toHaveLength(1);
      expect(await h.entries(f, s.id)).toHaveLength(0); // revenue never reaches the ledger: monitor M-1
    });

    it('payment methods cash / tab(no customer) / split post a balanced entry or fail closed', async () => {
      const f = await h.tenant('d1-pay');
      const a = await h.item(f, 'A');
      await h.receive(f, a, 10, 7);
      const cash = await h.runSale(f, [{ itemId: a, qty: 1, price: 20 }], { mode: 'pooled_stock_on', payment: 'cash', taxRate: 0.15 });
      const split = await h.runSale(f, [{ itemId: a, qty: 1, price: 20 }], { mode: 'pooled_stock_on', payment: 'split', taxRate: 0.15 });
      const tab = await h.runSale(f, [{ itemId: a, qty: 1, price: 20 }], { mode: 'pooled_stock_on', payment: 'tab' });
      expect(cash.ok && split.ok).toBe(true);
      expect(tab.ok).toBe(false); // tab needs a customer -> whole sale rolled back
      for (const s of [cash, split]) {
        if (!s.ok) continue;
        const [e] = await h.entries(f, s.id);
        expect(await h.entryBalanced(e.id)).toBe(true);
      }
      expect(await h.count('orders', f)).toBe(2);
      expect(await h.onHand(f, a)).toBe(8); // the failed tab sale left no deduction
    });
  });

  // ------------------------------------------------------------------ D-2 failure injection
  describe('D-2 failure injection', () => {
    it('(a) posting fails (missing sales_revenue role): NO order, NO items, NO movement, NO stock change, NO layer change, NO entry', async () => {
      const f = await h.tenant('d2a');
      const a = await h.item(f, 'A');
      await h.receive(f, a, 10, 7);
      await h.q("DELETE FROM account_role_assignments WHERE tenant_id=$1 AND role_code='sales_revenue'", [f.tenantId]);
      const s = await h.runSale(f, [{ itemId: a, qty: 2, price: 20 }], { mode: 'pooled_stock_on' });
      expect(s.ok).toBe(false);
      expect(await h.count('orders', f)).toBe(0);
      expect((await h.q('SELECT count(*)::int n FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.tenant_id=$1', [f.tenantId]))[0].n).toBe(0);
      expect((await h.q("SELECT count(*)::int n FROM stock_movements WHERE tenant_id=$1 AND movement_type='sale'", [f.tenantId]))[0].n).toBe(0);
      expect(await h.count('journal_entries', f)).toBe(0);
      expect(await h.onHand(f, a)).toBe(10);
      expect((await h.layers(f, a))[0].rem).toBe(10);
    });

    it('(a2) closed fiscal period: sale + stock rolled back together', async () => {
      const f = await h.tenant('d2a2');
      const a = await h.item(f, 'A');
      await h.receive(f, a, 10, 7);
      await h.q("UPDATE fiscal_periods SET status='closed' WHERE tenant_id=$1", [f.tenantId]);
      const s = await h.runSale(f, [{ itemId: a, qty: 2, price: 20 }], { mode: 'pooled_stock_on' });
      expect(s.ok).toBe(false);
      expect(await h.count('orders', f)).toBe(0);
      expect(await h.onHand(f, a)).toBe(10);
      expect((await h.layers(f, a))[0].rem).toBe(10);
    });

    it('(a3) a failure AFTER posting (afterPost hook, i.e. ZATCA issuing) rolls back order + stock + entry', async () => {
      const f = await h.tenant('d2a3');
      const a = await h.item(f, 'A');
      await h.receive(f, a, 10, 7);
      const s = await h.runSale(f, [{ itemId: a, qty: 2, price: 20 }], {
        mode: 'pooled_stock_on',
        afterPost: async () => {
          throw new Error('zatca down');
        },
      });
      expect(s.ok).toBe(false);
      expect(await h.count('orders', f)).toBe(0);
      expect(await h.count('journal_entries', f)).toBe(0);
      expect(await h.onHand(f, a)).toBe(10);
      expect((await h.layers(f, a))[0].rem).toBe(10);
    });

    it('(b) stock failure inside the savepoint is swallowed: sale + revenue entry commit, ZERO movements for ALL lines (savepoint is all-or-nothing), entry flagged, detectable', async () => {
      const f = await h.tenant('d2b');
      const good = await h.item(f, 'good');
      // standard costing without a standard_cost makes fn_consume_cost_layers RAISE -> deterministic stock failure
      const bad = await h.item(f, 'bad', { costing: 'standard', standardCost: null });
      await h.receive(f, good, 10, 7);
      await h.receive(f, bad, 10, 3);
      const s = await h.runSale(
        f,
        [
          { itemId: good, qty: 2, price: 20 },
          { itemId: bad, qty: 1, price: 9 },
        ],
        { mode: 'pooled_stock_on', taxRate: 0.15 },
      );
      expect(s.ok).toBe(true); // product rule: a stock problem never fails the sale
      if (!s.ok) return;
      expect(s.stockDeducted).toBe(false);
      expect(s.stockError).toMatch(/standard_cost/);
      // exactly what is persisted:
      expect(await h.count('orders', f)).toBe(1);
      expect(await h.movements(f, s.id)).toHaveLength(0); // even the GOOD line's deduction was rolled back with the savepoint
      expect(await h.onHand(f, good)).toBe(10);
      expect(await h.onHand(f, bad)).toBe(10);
      const [e] = await h.entries(f, s.id);
      expect(e.requires_cogs_reconciliation).toBe(true);
      expect((await h.lines(e.id)).find((l) => l.code === '5000')).toBeUndefined();
      // KNOWN-DEFECT: nothing durable records the swallowed failure. Only the app log + in-app notification of the
      // post-commit retry (which fails again for this data) exist. Detection is via monitors M-2/M-3 (migration 329).
      expect(await h.q("SELECT 1 FROM domain_events_outbox WHERE tenant_id=$1 AND event_type ILIKE '%stock%' AND payload::text ILIKE '%'||$2||'%'", [f.tenantId, s.id])).toHaveLength(0);
    });

    it('(b2) transient stock failure: savepoint failure then successful post-commit retry -> stock exists but the entry NEVER receives COGS (KNOWN-DEFECT, needs WP-E catch-up entry)', async () => {
      const f = await h.tenant('d2b2');
      const a = await h.item(f, 'A', { costing: 'standard', standardCost: null });
      await h.receive(f, a, 10, 7);
      // fail inside the transaction only: make standard_cost null during the sale, fix it before the retry
      const s = await h.runSale(f, [{ itemId: a, qty: 2, price: 20 }], { mode: 'pooled_stock_on', skipPostCommitDeduction: true });
      expect(s.ok && !s.stockDeducted).toBe(true);
      if (!s.ok) return;
      await h.q('UPDATE items SET standard_cost=7 WHERE id=$1', [a]);
      await h.repo.deductStockForSale(f.tenantId, f.warehouseId, s.id, null as never, [{ item_id: a, variant_id: null, quantity: 2 }]);
      expect(await h.movements(f, s.id)).toHaveLength(1);
      const [e] = await h.entries(f, s.id);
      expect((await h.lines(e.id)).find((l) => l.code === '5000')).toBeUndefined(); // movement cost 14 never reaches the ledger
      expect(e.requires_cogs_reconciliation).toBe(true);
    });

    it('(c) tracked item with ZERO cost layers and zero stock: sale completes, becomes a BACKORDER (no movement, no COGS), entry flagged', async () => {
      const f = await h.tenant('d2c');
      const a = await h.item(f, 'nolayer');
      const s = await h.runSale(f, [{ itemId: a, qty: 2, price: 20 }], { mode: 'pooled_stock_on' });
      expect(s.ok && s.stockDeducted).toBe(true);
      if (!s.ok) return;
      expect(await h.movements(f, s.id)).toHaveLength(0);
      expect(await h.backorder(f, a)).toBe(2);
      const [e] = await h.entries(f, s.id);
      expect(e.requires_cogs_reconciliation).toBe(true);
    });

    it('(c2) tracked item with stock but ZERO cost layers: movement is written at unit_cost 0 -> flagged entry with no COGS', async () => {
      const f = await h.tenant('d2c2');
      const a = await h.item(f, 'nolayer2');
      await h.q('INSERT INTO stock_levels (tenant_id, warehouse_id, item_id, quantity_on_hand) VALUES ($1,$2,$3,5)', [f.tenantId, f.warehouseId, a]);
      const s = await h.runSale(f, [{ itemId: a, qty: 2, price: 20 }], { mode: 'pooled_stock_on' });
      expect(s.ok && s.stockDeducted).toBe(true);
      if (!s.ok) return;
      const mv = await h.movements(f, s.id);
      expect(mv).toHaveLength(1);
      expect(Number(mv[0].total_cost)).toBe(0);
      const [e] = await h.entries(f, s.id);
      expect(e.requires_cogs_reconciliation).toBe(true);
      expect(await h.onHand(f, a)).toBe(3);
    });
  });

  // ------------------------------------------------------------------ D-3 / D-4 retry, replay
  describe('D-3 / D-4 retry and replay', () => {
    it('D-3 same sale_attempt_id sequentially: second attempt is a unique violation (23505), nothing duplicated', async () => {
      const f = await h.tenant('d3seq');
      const a = await h.item(f, 'A');
      await h.receive(f, a, 10, 7);
      const attempt = randomUUID();
      const s1 = await h.runSale(f, [{ itemId: a, qty: 2, price: 20 }], { mode: 'pooled_stock_on', attemptId: attempt });
      const s2 = await h.runSale(f, [{ itemId: a, qty: 2, price: 20 }], { mode: 'pooled_stock_on', attemptId: attempt });
      expect(s1.ok).toBe(true);
      expect(s2.ok).toBe(false);
      if (!s2.ok) expect(s2.code).toBe('23505');
      expect(await h.count('orders', f)).toBe(1);
      expect(await h.count('journal_entries', f)).toBe(1);
      expect((await h.q("SELECT count(*)::int n FROM stock_movements WHERE tenant_id=$1 AND movement_type='sale'", [f.tenantId]))[0].n).toBe(1);
      expect(await h.onHand(f, a)).toBe(8);
    });

    it.each(['pooled_stock_on', 'pooled_stock_off'] as const)('D-3 same sale_attempt_id concurrently (2 connections, %s): exactly one order / movement set / entry / deduction', async (mode) => {
      const f = await h.tenant('d3con');
      const a = await h.item(f, 'A');
      await h.receive(f, a, 10, 7);
      const attempt = randomUUID();
      const r = await Promise.all(
        [0, 1, 2].map(() => h.runSale(f, [{ itemId: a, qty: 2, price: 20 }], { mode, attemptId: attempt })),
      );
      expect(r.filter((x) => x.ok)).toHaveLength(1);
      for (const x of r.filter((y) => !y.ok)) expect((x as any).code).toBe('23505');
      expect(await h.count('orders', f)).toBe(1);
      expect(await h.count('journal_entries', f)).toBe(1);
      expect((await h.q("SELECT count(*)::int n FROM stock_movements WHERE tenant_id=$1 AND movement_type='sale'", [f.tenantId]))[0].n).toBe(1);
      expect(await h.onHand(f, a)).toBe(8);
      expect((await h.layers(f, a))[0].rem).toBe(8);
    });

    it('retry after a DB failure of the post-commit deduction: the sale committed once; a later successful retry deducts exactly once', async () => {
      const f = await h.tenant('d3retry');
      const a = await h.item(f, 'A');
      await h.receive(f, a, 10, 7);
      const s = await h.runSale(f, [{ itemId: a, qty: 2, price: 20 }], { mode: 'pooled_stock_off', skipPostCommitDeduction: true });
      expect(s.ok).toBe(true);
      if (!s.ok) return;
      expect(await h.movements(f, s.id)).toHaveLength(0);
      expect(await h.onHand(f, a)).toBe(10);
      await h.repo.deductStockForSale(f.tenantId, f.warehouseId, s.id, null as never, [{ item_id: a, variant_id: null, quantity: 2 }]);
      expect(await h.movements(f, s.id)).toHaveLength(1);
      expect(await h.onHand(f, a)).toBe(8);
    });
  });

  // ------------------------------------------------------------------ D-5 / D-6 costing
  describe('D-5 historical COGS immutability', () => {
    it('sale at c1, then a new layer at c2 and a second receipt: the original entry lines and movement cost never change', async () => {
      const f = await h.tenant('d5');
      const a = await h.item(f, 'A');
      await h.receive(f, a, 10, 7);
      const s = await h.runSale(f, [{ itemId: a, qty: 4, price: 20 }], { mode: 'pooled_stock_on' });
      expect(s.ok).toBe(true);
      if (!s.ok) return;
      const [e0] = await h.entries(f, s.id);
      const before = JSON.stringify(await h.lines(e0.id));
      const mv0 = (await h.movements(f, s.id))[0];
      await h.receive(f, a, 10, 9);
      await h.q('UPDATE items SET cost_price=99, standard_cost=99 WHERE id=$1', [a]);
      await h.receive(f, a, 5, 12);
      const mv1 = (await h.movements(f, s.id))[0];
      expect(Number(mv1.total_cost)).toBe(Number(mv0.total_cost));
      expect(Number(mv1.unit_cost)).toBe(7);
      expect(JSON.stringify(await h.lines(e0.id))).toBe(before);
      // and the DB itself refuses to rewrite history
      await expect(h.q('UPDATE stock_movements SET total_cost=1 WHERE id=$1', [mv0.id])).rejects.toThrow();
      await expect(h.q("UPDATE journal_lines SET debit_amount=1 WHERE journal_entry_id=$1 AND account_id IN (SELECT id FROM accounts WHERE tenant_id=$2 AND code='5000')", [e0.id, f.tenantId])).rejects.toThrow();
    });
  });

  describe('D-6 FIFO multi-layer and standard cost', () => {
    it('FIFO across layers: 100@7 + 100@8, sell 120 => COGS 860, unit 7.1667, layers 0 / 80', async () => {
      const f = await h.tenant('d6fifo');
      const a = await h.item(f, 'A');
      await h.receive(f, a, 100, 7);
      await h.receive(f, a, 100, 8);
      const s = await h.runSale(f, [{ itemId: a, qty: 120, price: 20 }], { mode: 'pooled_stock_on' });
      expect(s.ok).toBe(true);
      if (!s.ok) return;
      const mv = (await h.movements(f, s.id))[0];
      expect(Number(mv.unit_cost)).toBeCloseTo(7.1667, 4);
      const [e] = await h.entries(f, s.id);
      const cogs = (await h.lines(e.id)).find((l) => l.code === '5000');
      // total_cost = qty * ROUNDED unit cost (7.1667*120 = 860.004): documented rounding drift of 0.004 vs the exact 860
      expect(Number(mv.total_cost)).toBeCloseTo(860.004, 3);
      expect(Number(cogs.d)).toBeCloseTo(860, 0);
      const ls = await h.layers(f, a);
      expect([ls[0].rem, ls[1].rem]).toEqual([0, 80]);
    });

    it('KNOWN-DEFECT (rounding): movement cost = qty x unit cost rounded to 4dp, so total_cost can differ from the layer value consumed (860.004 vs 860); the entry rounds to 2dp (860.00) while the layer drained 860 -> sub-cent drift in the inventory reconciliation', async () => {
      const f = await h.tenant('d6round');
      const a = await h.item(f, 'A');
      await h.receive(f, a, 1, 1);
      await h.receive(f, a, 2, 1.01);
      const s = await h.runSale(f, [{ itemId: a, qty: 3, price: 20 }], { mode: 'pooled_stock_on' });
      expect(s.ok).toBe(true);
      if (!s.ok) return;
      const mv = (await h.movements(f, s.id))[0];
      const consumed = 1 * 1 + 2 * 1.01; // 3.02
      expect(Number(mv.unit_cost)).toBeCloseTo(1.0067, 4);
      expect(Number(mv.total_cost)).toBeCloseTo(3.0201, 4); // not 3.02
      const [e] = await h.entries(f, s.id);
      const cogs = (await h.lines(e.id)).find((l) => l.code === '5000');
      expect(Number(cogs.d)).toBe(3.02);
      expect(Math.abs(Number(mv.total_cost) - consumed)).toBeGreaterThan(0);
    });

    it('standard cost: COGS uses the fixed standard cost regardless of layer cost; purchase variance stays in the layers', async () => {
      const f = await h.tenant('d6std');
      const a = await h.item(f, 'A', { costing: 'standard', standardCost: 5 });
      await h.receive(f, a, 10, 8);
      const s = await h.runSale(f, [{ itemId: a, qty: 3, price: 20 }], { mode: 'pooled_stock_on' });
      expect(s.ok).toBe(true);
      if (!s.ok) return;
      const mv = (await h.movements(f, s.id))[0];
      expect(Number(mv.unit_cost)).toBe(5);
      expect(Number(mv.total_cost)).toBe(15);
      expect((await h.layers(f, a))[0]).toMatchObject({ uc: 8, rem: 7 }); // layer drained at its own cost basis (variance visible)
      const [e] = await h.entries(f, s.id);
      expect(Number((await h.lines(e.id)).find((l) => l.code === '5000').d)).toBe(15);
    });

    it('average costing: new receipt blends into the open layer; sale uses the blended cost', async () => {
      const f = await h.tenant('d6avg');
      const a = await h.item(f, 'A', { costing: 'average' });
      await h.receive(f, a, 10, 6);
      await h.receive(f, a, 10, 8);
      const s = await h.runSale(f, [{ itemId: a, qty: 4, price: 20 }], { mode: 'pooled_stock_on' });
      expect(s.ok).toBe(true);
      if (!s.ok) return;
      expect(Number((await h.movements(f, s.id))[0].unit_cost)).toBe(7);
    });
  });
});

export type _Fx = Fx;
