/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any */
/**
 * WP-D proof, part 3 — purchases / goods receipts, stock counts and adjustments, transfers, sale concurrency (last unit),
 * and ledger-vs-inventory / ledger-vs-reports reconciliation (D-10).
 *
 * LOCAL DISPOSABLE DATABASE ONLY. Tests prefixed `KNOWN-DEFECT:` / `KNOWN-GAP:` assert today's behaviour on purpose.
 * Headline fact (VERIFIED from pg_proc): only fn_post_sales_order, fn_reverse_sales_order and fn_create_sales_return create
 * journal entries. Receipts, counts, adjustments, transfers and production move stock and cost layers but post NOTHING.
 */
import { Harness, round2 } from './support/sale-path-fixtures';
import { randomUUID } from 'crypto';

jest.setTimeout(180000);

describe('WP-D sale path proof (3/3): inventory operations, concurrency, reconciliation', () => {
  const h = new Harness();
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL (local) required');
    await h.open();
  });
  afterAll(async () => h.close());

  // ------------------------------------------------------------------ purchases / goods receipts
  describe('purchases / goods receipts', () => {
    it('receipt: stock +qty, a discrete cost layer at the cost, a receipt movement; KNOWN-GAP: NO journal entry, so the inventory asset account never sees purchases', async () => {
      const f = await h.tenant('gr');
      const a = await h.item(f, 'A');
      await h.receive(f, a, 10, 7);
      expect(await h.onHand(f, a)).toBe(10);
      expect(await h.layers(f, a)).toEqual([{ uc: 7, rem: 10, rcv: 10 }]);
      const mv = await h.q("SELECT * FROM stock_movements WHERE tenant_id=$1 AND movement_type='receipt'", [f.tenantId]);
      expect(mv).toHaveLength(1);
      expect(Number(mv[0].total_cost)).toBe(70);
      expect(await h.count('journal_entries', f)).toBe(0); // KNOWN-GAP (Phase 2 events)
    });

    it('landed cost is allocated into the layer cost', async () => {
      const f = await h.tenant('grlanded');
      const a = await h.item(f, 'A');
      const [gr] = await h.q("INSERT INTO goods_receipts (tenant_id, warehouse_id, receipt_number, status) VALUES ($1,$2,'GR-L','draft') RETURNING id", [f.tenantId, f.warehouseId]);
      await h.q('INSERT INTO goods_receipt_items (tenant_id, goods_receipt_id, item_id, quantity_received, unit_cost) VALUES ($1,$2,$3,10,7)', [f.tenantId, gr.id, a]);
      await h.q("INSERT INTO landed_costs (tenant_id, goods_receipt_id, cost_type, amount, allocation_method) VALUES ($1,$2,'shipping',10,'by_value')", [f.tenantId, gr.id]);
      await h.q('SELECT fn_post_goods_receipt($1, NULL)', [gr.id]);
      const [l] = await h.layers(f, a);
      expect(l.uc).toBe(8); // 7 + 10/10
    });

    it('double posting of the same receipt is rejected (status guard)', async () => {
      const f = await h.tenant('grdup');
      const a = await h.item(f, 'A');
      const id = await h.receive(f, a, 10, 7);
      await expect(h.q('SELECT fn_post_goods_receipt($1, NULL)', [id])).rejects.toThrow(/not in draft/);
      expect(await h.onHand(f, a)).toBe(10);
    });

    it('receipt reversal removes stock and the layer; refused (and atomic) once units were sold', async () => {
      const f = await h.tenant('grrev');
      const a = await h.item(f, 'A');
      const id = await h.receive(f, a, 10, 7);
      await h.q('SELECT fn_reverse_goods_receipt($1, NULL)', [id]);
      expect(await h.onHand(f, a)).toBe(0);
      expect(await h.layers(f, a)).toHaveLength(0);
      const id2 = await h.receive(f, a, 10, 7);
      const s = await h.runSale(f, [{ itemId: a, qty: 4, price: 20 }], { mode: 'pooled_stock_on' });
      expect(s.ok).toBe(true);
      await expect(h.q('SELECT fn_reverse_goods_receipt($1, NULL)', [id2])).rejects.toThrow(/REVERSAL_UNSAFE/);
      expect(await h.onHand(f, a)).toBe(6);
    });
  });

  // ------------------------------------------------------------------ stock counts and adjustments
  describe('stock counts and adjustments', () => {
    async function count(f: any, a: string, expected: number, counted: number) {
      const [sc] = await h.q("INSERT INTO stock_counts (tenant_id, warehouse_id, count_number, status) VALUES ($1,$2,$3,'in_progress') RETURNING id", [f.tenantId, f.warehouseId, `SC-${randomUUID().slice(0, 6)}`]);
      await h.q('INSERT INTO stock_count_items (tenant_id, stock_count_id, item_id, expected_quantity, counted_quantity) VALUES ($1,$2,$3,$4,$5)', [f.tenantId, sc.id, a, expected, counted]);
      await h.q('SELECT fn_finalize_stock_count($1, NULL)', [sc.id]);
      return sc.id as string;
    }

    it('count shortage: stock reduced, cost layers consumed at layer cost, movement count_correction_out at that cost; KNOWN-GAP: no journal entry (shrinkage never expensed)', async () => {
      const f = await h.tenant('cntout');
      const a = await h.item(f, 'A');
      await h.receive(f, a, 10, 7);
      const id = await count(f, a, 10, 8);
      expect(await h.onHand(f, a)).toBe(8);
      expect((await h.layers(f, a))[0].rem).toBe(8);
      const [m] = await h.q("SELECT * FROM stock_movements WHERE reference_id=$1 AND movement_type='count_correction_out'", [id]);
      expect(Number(m.total_cost)).toBe(14);
      expect(await h.count('journal_entries', f)).toBe(0);
    });

    it('KNOWN-DEFECT (low): count surplus is valued at items.cost_price (NULL -> 0), NOT at the layer/last receipt cost, so a surplus enters at cost 0 unless cost_price is maintained', async () => {
      const f = await h.tenant('cntin');
      const a = await h.item(f, 'A');
      await h.receive(f, a, 10, 7);
      const id = await count(f, a, 10, 12);
      const [m] = await h.q("SELECT * FROM stock_movements WHERE reference_id=$1 AND movement_type='count_correction_in'", [id]);
      expect(Number(m.unit_cost)).toBe(0); // 7 would be the receipt cost
      expect(await h.onHand(f, a)).toBe(12);
      expect(await h.layerValue(f)).toBe(70); // 10x7 + 2x0
    });

    it('stock adjustment in / out: stock and layers follow; out beyond layers is refused atomically', async () => {
      const f = await h.tenant('adj');
      const a = await h.item(f, 'A');
      await h.receive(f, a, 10, 7);
      const adj = async (delta: number, cost: number | null = null) => {
        const [r] = await h.q("INSERT INTO stock_adjustments (tenant_id, warehouse_id, item_id, quantity_delta, unit_cost, reason, status, requires_approval) VALUES ($1,$2,$3,$4,$5,'t2','approved',false) RETURNING id", [f.tenantId, f.warehouseId, a, delta, cost]);
        return h.q('SELECT fn_post_stock_adjustment($1, NULL)', [r.id]);
      };
      await adj(5, 9);
      expect(await h.onHand(f, a)).toBe(15);
      expect(await h.layerValue(f)).toBe(70 + 45);
      await adj(-3);
      expect(await h.onHand(f, a)).toBe(12);
      await expect(adj(-100)).rejects.toThrow();
      expect(await h.onHand(f, a)).toBe(12);
      expect(await h.count('journal_entries', f)).toBe(0); // KNOWN-GAP
    });
  });

  // ------------------------------------------------------------------ transfers
  describe('transfers between stock points', () => {
    async function transfer(f: any, a: string, qty: number, stopAt: 'dispatch' | 'complete' = 'complete') {
      const [t] = await h.q("INSERT INTO stock_transfers (tenant_id, from_warehouse_id, to_warehouse_id, transfer_number, status) VALUES ($1,$2,$3,$4,'draft') RETURNING id", [f.tenantId, f.warehouseId, f.warehouse2Id, `TR-${randomUUID().slice(0, 6)}`]);
      await h.q('INSERT INTO stock_transfer_items (tenant_id, stock_transfer_id, item_id, quantity) VALUES ($1,$2,$3,$4)', [f.tenantId, t.id, a, qty]);
      await h.q('SELECT fn_transfer_approve($1, NULL)', [t.id]);
      await h.q('SELECT fn_transfer_dispatch($1, NULL)', [t.id]);
      if (stopAt === 'dispatch') return t.id as string;
      await h.q('SELECT fn_transfer_receive($1, NULL)', [t.id]);
      await h.q('SELECT fn_transfer_complete($1, NULL)', [t.id]);
      return t.id as string;
    }

    it('transfer: source -qty, destination +qty, value moves with the goods at the dispatched cost; no ledger effect (single owner: value is internal)', async () => {
      const f = await h.tenant('tr');
      const a = await h.item(f, 'A');
      await h.receive(f, a, 10, 7);
      await transfer(f, a, 4);
      expect(await h.onHand(f, a)).toBe(6);
      expect(await h.onHand(f, a, f.warehouse2Id)).toBe(4);
      expect(await h.layers(f, a, f.warehouse2Id)).toEqual([{ uc: 7, rem: 4, rcv: 4 }]);
      expect(await h.layerValue(f)).toBe(70);
      expect(await h.count('journal_entries', f)).toBe(0);
    });

    it('in transit: stock has left the source and is in NO warehouse until received (visible dip)', async () => {
      const f = await h.tenant('trtransit');
      const a = await h.item(f, 'A');
      await h.receive(f, a, 10, 7);
      await transfer(f, a, 4, 'dispatch');
      expect((await h.onHand(f, a)) + (await h.onHand(f, a, f.warehouse2Id))).toBe(6);
    });

    it('selling after a transfer: the source cannot sell what left', async () => {
      const f = await h.tenant('trsell');
      const a = await h.item(f, 'A');
      await h.receive(f, a, 10, 8);
      await transfer(f, a, 4);
      const s = await h.runSale(f, [{ itemId: a, qty: 6, price: 20 }], { mode: 'pooled_stock_on' });
      expect(s.ok && s.stockDeducted).toBe(true);
      expect(await h.onHand(f, a)).toBe(0);
      expect(await h.onHand(f, a, f.warehouse2Id)).toBe(4);
    });

    it('KNOWN-DEFECT (rounding, sub-cent): multi-layer transfer re-costs the destination layer at a 4dp average, creating value (860.004 vs 860 consumed)', async () => {
      const f = await h.tenant('trround');
      const a = await h.item(f, 'A');
      await h.receive(f, a, 100, 7);
      await h.receive(f, a, 100, 8);
      await transfer(f, a, 120);
      const consumedValue = 100 * 7 + 20 * 8;
      const dest = await h.layers(f, a, f.warehouse2Id);
      expect(dest).toHaveLength(1);
      expect(dest[0].rem).toBe(120);
      expect(dest[0].uc).toBeCloseTo(7.1667, 4);
      expect(round2(dest[0].uc * dest[0].rem)).toBe(860);
      expect(dest[0].uc * dest[0].rem).not.toBe(consumedValue); // 860.004
    });

    it('transfer of more than the source holds is refused atomically', async () => {
      const f = await h.tenant('trover');
      const a = await h.item(f, 'A');
      await h.receive(f, a, 3, 7);
      await expect(transfer(f, a, 10)).rejects.toThrow();
      expect(await h.onHand(f, a)).toBe(3);
      expect(await h.layerValue(f)).toBe(21);
    });
  });

  // ------------------------------------------------------------------ concurrency
  describe('concurrency on the last unit', () => {
    it('two sales of the last unit (2 connections): BOTH sales commit (backorder policy), exactly 1 unit is deducted, the other becomes a backorder with a flagged entry; stock never negative', async () => {
      const f = await h.tenant('conc2');
      const a = await h.item(f, 'A');
      await h.receive(f, a, 1, 7);
      const r = await Promise.all([0, 1].map(() => h.runSale(f, [{ itemId: a, qty: 1, price: 20 }], { mode: 'pooled_stock_on' })));
      expect(r.every((x) => x.ok)).toBe(true); // documented: the product OVERSELLS by design (never blocks a sale)
      const mv = await h.q("SELECT count(*)::int n FROM stock_movements WHERE tenant_id=$1 AND movement_type='sale'", [f.tenantId]);
      expect(mv[0].n).toBe(1);
      expect(await h.onHand(f, a)).toBe(0);
      expect(await h.backorder(f, a)).toBe(1);
      const flagged = await h.q('SELECT count(*)::int n FROM journal_entries WHERE tenant_id=$1 AND requires_cogs_reconciliation', [f.tenantId]);
      expect(flagged[0].n).toBe(1);
      const lv = await h.q('SELECT min(quantity_on_hand)::float8 m FROM stock_levels WHERE tenant_id=$1', [f.tenantId]);
      expect(lv[0].m).toBeGreaterThanOrEqual(0);
    });

    it('8 parallel sales of 1 unit on 5 in stock: exactly 5 deducted, 3 backordered, layers 0, on-hand 0, 8 orders, 8 entries, ledger COGS == movements', async () => {
      const f = await h.tenant('conc8');
      const a = await h.item(f, 'A');
      await h.receive(f, a, 5, 7);
      const r = await Promise.all(Array.from({ length: 8 }, () => h.runSale(f, [{ itemId: a, qty: 1, price: 20 }], { mode: 'pooled_stock_on' })));
      expect(r.every((x) => x.ok)).toBe(true);
      expect(await h.count('orders', f)).toBe(8);
      expect(await h.count('journal_entries', f)).toBe(8);
      expect(await h.onHand(f, a)).toBe(0);
      expect(await h.backorder(f, a)).toBe(3);
      expect((await h.layers(f, a))[0].rem).toBe(0);
      const mvCost = (await h.q("SELECT coalesce(sum(total_cost),0)::float8 c FROM stock_movements WHERE tenant_id=$1 AND movement_type='sale'", [f.tenantId]))[0].c;
      expect(mvCost).toBe(35);
      expect((await h.balances(f))['5000']).toBe(35);
    });
  });

  // ------------------------------------------------------------------ D-10 reconciliation
  describe('D-10 reconciliation (read-only comparisons, explained deltas)', () => {
    it('inventory asset account vs cost-layer value: delta equals the receipts never posted to the ledger plus the standard-cost variance (KNOWN-GAP, informational M-6)', async () => {
      const f = await h.tenant('rec1');
      const a = await h.item(f, 'A');
      const b = await h.item(f, 'B', { costing: 'standard', standardCost: 5 });
      await h.receive(f, a, 10, 7);
      await h.receive(f, b, 20, 4);
      await h.runSale(f, [{ itemId: a, qty: 3, price: 20 }, { itemId: b, qty: 5, price: 9 }], { mode: 'pooled_stock_on' });
      const receiptsValue = 10 * 7 + 20 * 4; // 150
      const ledgerInventory = (await h.balances(f))['1200']; // debit - credit
      const cogsValue = 3 * 7 + 5 * 5; // standard cost: 46
      expect(ledgerInventory).toBe(-cogsValue);
      const layerValue = await h.layerValue(f);
      const consumedAtLayerCost = 3 * 7 + 5 * 4; // 41
      expect(layerValue).toBe(receiptsValue - consumedAtLayerCost);
      expect(round2(ledgerInventory - layerValue)).toBe(round2(-cogsValue - (receiptsValue - consumedAtLayerCost)));
      expect(cogsValue - consumedAtLayerCost).toBe(5); // purchase price variance: recognised in COGS, sits nowhere else
    });

    it('sales / tax / settlement accounts vs operational sales for a generated day: equal for sales-only data; deltas explained by returns (tax) and cancels (none) (SEF-R-007)', async () => {
      const f = await h.tenant('rec2');
      const a = await h.item(f, 'A');
      await h.receive(f, a, 200, 3);
      const shift = await h.openShift(f);
      const mk = async (qty: number, price: number, payment: any, discount = 0, taxRate = 0.15) => {
        const s = await h.runSale(f, [{ itemId: a, qty, price }], { mode: 'pooled_stock_on', payment, discount, taxRate });
        if (!s.ok) throw new Error(JSON.stringify(s));
        return s.id;
      };
      await mk(3, 19.99, 'cash');
      await mk(7, 4.35, 'card', 2.5);
      await mk(1, 100, 'split', 10);
      const toCancel = await mk(2, 33.33, 'card');
      const toReturn = await mk(5, 12.5, 'cash', 5);
      const operational = async () => {
        const [o] = await h.q("SELECT coalesce(sum(subtotal-discount),0)::float8 net, coalesce(sum(tax),0)::float8 tax, coalesce(sum(total),0)::float8 total FROM orders WHERE tenant_id=$1 AND status='completed'", [f.tenantId]);
        return o;
      };
      let b = await h.balances(f);
      let op = await operational();
      expect(-b['4000']).toBe(round2(op.net));
      expect(-b['2200']).toBe(round2(op.tax));
      expect(round2((b['1000'] ?? 0) + (b['1010'] ?? 0))).toBe(round2(op.total));
      expect((await h.runCancel(f, toCancel)).ok).toBe(true);
      const [oi] = await h.orderItemIds(toReturn);
      const ret = await h.doReturn(f, toReturn, [[oi, 2]], shift);
      expect(ret.ok).toBe(true);
      b = await h.balances(f);
      op = await operational(); // a cancelled order leaves 'completed' => operational already excludes it
      const [r] = await h.q('SELECT coalesce(sum(net_amount),0)::float8 net, coalesce(sum(tax_amount),0)::float8 tax, coalesce(sum(refund_total),0)::float8 refund FROM sales_returns WHERE tenant_id=$1', [f.tenantId]);
      expect(-b['4000']).toBe(round2(op.net - r.net)); // == reports net_revenue_after_returns
      expect(round2(op.tax - -b['2200'])).toBe(round2(r.tax)); // reports total_tax does not deduct returned tax
      expect(round2((b['1000'] ?? 0) + (b['1010'] ?? 0))).toBe(round2(op.total - r.refund));
    });

    it('stock_levels equal the sum of signed movements per stock point for a mixed history (receipt, sale, cancel, return)', async () => {
      const f = await h.tenant('rec3');
      const a = await h.item(f, 'A');
      await h.receive(f, a, 50, 7);
      const s1 = await h.runSale(f, [{ itemId: a, qty: 10, price: 20 }], { mode: 'pooled_stock_on' });
      if (!s1.ok) throw new Error('setup');
      await h.runCancel(f, s1.id);
      const s2 = await h.runSale(f, [{ itemId: a, qty: 6, price: 20 }], { mode: 'pooled_stock_on', taxRate: 0.15 });
      if (!s2.ok) throw new Error('setup');
      const [oi] = await h.orderItemIds(s2.id);
      await h.doReturn(f, s2.id, [[oi, 2]]);
      const rows = await h.q(
        `SELECT m.warehouse_id, sum(CASE m.direction WHEN 'in' THEN m.quantity ELSE -m.quantity END)::float8 net
           FROM stock_movements m WHERE m.tenant_id=$1 AND m.item_id=$2 GROUP BY m.warehouse_id`,
        [f.tenantId, a],
      );
      for (const r of rows) expect(await h.onHand(f, a, r.warehouse_id)).toBe(r.net);
      expect(rows[0].net).toBe(50 - 6 + 2);
    });
  });
});
