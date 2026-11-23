/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any */
/**
 * D-11: monitors M-1..M-9 (migrations_pending/329_financial_monitoring.sql) against injected defects and clean data.
 * LOCAL DISPOSABLE DATABASE ONLY. Also proves: read-only (STABLE + READ ONLY transaction), service_role-only grants,
 * rollback and idempotent re-apply.
 */
import * as fs from 'fs';
import * as path from 'path';
import { Harness } from './support/sale-path-fixtures';
import { randomUUID } from 'crypto';

jest.setTimeout(180000);
const PENDING = path.resolve(__dirname, '..', '..', 'migrations_pending');
const read = (...p: string[]) => fs.readFileSync(path.join(PENDING, ...p), 'utf8').replace(/\r/g, '');

describe('D-11 financial monitors M-1..M-9 (329)', () => {
  const h = new Harness();
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL (local) required');
    await h.open();
  });
  afterAll(async () => h.close());

  /** findings for one tenant, no grace; optionally one check */
  async function mon(f: { tenantId: string }, check?: string, grace = '0 seconds') {
    const rows = await h.q('SELECT * FROM fn_fin_monitor_all($1, $2::interval)', [f.tenantId, grace]);
    return check ? rows.filter((r) => r.check_id === check) : rows;
  }
  const actionable = (rows: any[]) => rows.filter((r) => r.severity !== 'info' && r.check_id !== 'M-7');

  describe('clean data returns nothing actionable', () => {
    it('receipt + sale + cancel + partial return + backordered-then-received history: M-1..M-5, M-8, M-9 are empty', async () => {
      const f = await h.tenant('m-clean');
      const a = await h.item(f, 'A');
      await h.receive(f, a, 50, 7);
      const s1 = await h.runSale(f, [{ itemId: a, qty: 4, price: 20 }], { mode: 'pooled_stock_on', taxRate: 0.15 });
      const s2 = await h.runSale(f, [{ itemId: a, qty: 3, price: 20 }], { mode: 'pooled_stock_on', taxRate: 0.15 });
      if (!s1.ok || !s2.ok) throw new Error('setup');
      expect((await h.runCancel(f, s1.id)).ok).toBe(true);
      const [oi] = await h.orderItemIds(s2.id);
      expect((await h.doReturn(f, s2.id, [[oi, 1]])).ok).toBe(true);
      await h.q("INSERT INTO orders (tenant_id, branch_id, status, subtotal, discount, tax, total, payment_method, sale_attempt_id, held) VALUES ($1,$2,'completed',0,0,0,0,'cash',$3,false)", [f.tenantId, f.branchId, randomUUID()]); // free order posts nothing
      expect(actionable(await mon(f))).toEqual([]);
    });

    it('a fully backordered sale is NOT an M-3 finding (backorder row accepted) but IS an M-2 finding (no cost reached the ledger)', async () => {
      const f = await h.tenant('m-bo');
      const a = await h.item(f, 'A');
      const s = await h.runSale(f, [{ itemId: a, qty: 2, price: 20 }], { mode: 'pooled_stock_on' });
      if (!s.ok) throw new Error('setup');
      expect(await mon(f, 'M-3')).toEqual([]);
      expect((await mon(f, 'M-2')).map((r) => r.detail.source_entity_id)).toEqual([s.id]);
    });
  });

  describe('injected defects are returned', () => {
    it('M-1 critical: legacy-path order without an entry; free order excluded; the grace window hides a brand-new sale', async () => {
      const f = await h.tenant('m1');
      const a = await h.item(f, 'A');
      await h.receive(f, a, 10, 7);
      const legacy = await h.runSale(f, [{ itemId: a, qty: 2, price: 20 }], { mode: 'pooled_off' });
      await h.runSale(f, [{ itemId: a, qty: 1, price: 20 }], { mode: 'pooled_stock_on' }); // healthy
      if (!legacy.ok) throw new Error('setup');
      const rows = await mon(f, 'M-1');
      expect(rows.map((r) => r.subject_id)).toEqual([legacy.id]);
      expect(rows[0].severity).toBe('critical');
      expect(Number(rows[0].amount)).toBe(40);
      expect(await mon(f, 'M-1', '5 minutes')).toEqual([]); // grace default hides it
    });

    it('M-2 + M-3 high: stock failure swallowed in the savepoint -> flagged entry AND tracked line without movement; M-2 amount shows the cost that is not in the ledger when stock lands late', async () => {
      const f = await h.tenant('m23');
      const bad = await h.item(f, 'bad', { costing: 'standard', standardCost: null });
      await h.receive(f, bad, 10, 3);
      const s = await h.runSale(f, [{ itemId: bad, qty: 1, price: 9 }], { mode: 'pooled_stock_on', skipPostCommitDeduction: true });
      if (!s.ok) throw new Error('setup');
      const m3 = await mon(f, 'M-3');
      expect(m3.map((r) => r.subject_id)).toEqual([s.id]);
      expect(m3[0].detail).toMatchObject({ tracked_lines: 1, lines_without_movement: 1 });
      expect((await mon(f, 'M-2')).map((r) => r.detail.source_entity_id)).toEqual([s.id]);
      // late successful deduction: M-3 clears, M-2 stays and now reports the unbooked cost
      await h.q('UPDATE items SET standard_cost=3 WHERE id=$1', [bad]);
      await h.repo.deductStockForSale(f.tenantId, f.warehouseId, s.id, null as never, [{ item_id: bad, variant_id: null, quantity: 1 }]);
      expect(await mon(f, 'M-3')).toEqual([]);
      const m2 = await mon(f, 'M-2');
      expect(m2).toHaveLength(1);
      expect(Number(m2[0].amount)).toBe(3);
    });

    it('M-2: stock-in-tx OFF sale is flagged (COGS never posted) while M-3 stays clean', async () => {
      const f = await h.tenant('m2off');
      const a = await h.item(f, 'A');
      await h.receive(f, a, 10, 7);
      const s = await h.runSale(f, [{ itemId: a, qty: 2, price: 20 }], { mode: 'pooled_stock_off' });
      if (!s.ok) throw new Error('setup');
      const m2 = await mon(f, 'M-2');
      expect(m2).toHaveLength(1);
      expect(Number(m2[0].amount)).toBe(14);
      expect(await mon(f, 'M-3')).toEqual([]);
    });

    it('M-4: sale movement with cost but no order entry is high (legacy path); receipts appear only as info aggregates', async () => {
      const f = await h.tenant('m4');
      const a = await h.item(f, 'A');
      await h.receive(f, a, 10, 7);
      const legacy = await h.runSale(f, [{ itemId: a, qty: 2, price: 20 }], { mode: 'pooled_off' });
      if (!legacy.ok) throw new Error('setup');
      const rows = await mon(f, 'M-4');
      const high = rows.filter((r) => r.severity === 'high');
      expect(high).toHaveLength(1);
      expect(Number(high[0].amount)).toBe(14);
      expect(high[0].detail.order_id).toBe(legacy.id);
      const info = rows.filter((r) => r.severity === 'info');
      expect(info.map((r) => r.detail.movement_type)).toEqual(['receipt']);
      expect(Number(info[0].amount)).toBe(70);
    });

    it('M-5: on-hand drift against movements and stock that exists without any movement are both reported', async () => {
      const f = await h.tenant('m5');
      const a = await h.item(f, 'A');
      const orphan = await h.item(f, 'orphan');
      await h.receive(f, a, 10, 7);
      await h.q('UPDATE stock_levels SET quantity_on_hand = quantity_on_hand + 3 WHERE tenant_id=$1 AND item_id=$2', [f.tenantId, a]);
      await h.q('INSERT INTO stock_levels (tenant_id, warehouse_id, item_id, quantity_on_hand) VALUES ($1,$2,$3,5)', [f.tenantId, f.warehouseId, orphan]);
      const rows = await mon(f, 'M-5');
      const byItem = Object.fromEntries(rows.map((r) => [r.detail.item_id, Number(r.amount)]));
      expect(byItem[a]).toBe(3);
      expect(byItem[orphan]).toBe(5);
      expect(rows).toHaveLength(2);
    });

    it('M-6 info: inventory-asset ledger vs cost layers delta is reported with both sides (receipts not posted to the ledger)', async () => {
      const f = await h.tenant('m6');
      const a = await h.item(f, 'A');
      await h.receive(f, a, 10, 7);
      await h.runSale(f, [{ itemId: a, qty: 2, price: 20 }], { mode: 'pooled_stock_on' });
      const [r] = await mon(f, 'M-6');
      expect(r.severity).toBe('info');
      expect(Number(r.detail.ledger_inventory_balance)).toBe(-14);
      expect(Number(r.detail.cost_layer_value)).toBe(56);
      expect(Number(r.amount)).toBe(-70); // == -(receipts 70): fully explained
    });

    it('M-7: fiscal coverage reuses 325 — a calendar ending soon is critical/high; extending it clears the finding', async () => {
      const f = await h.tenant('m7');
      const [{ y }] = await h.q('SELECT extract(year from now())::int y');
      const near = await h.q('SELECT * FROM fn_fin_monitor_m7_fiscal_coverage($1, 400)', [f.tenantId]);
      expect(near).toHaveLength(1);
      expect(['critical', 'high', 'medium']).toContain(near[0].severity);
      expect(Number(near[0].amount)).toBe(
        (await h.q('SELECT days_remaining::int d FROM v_fiscal_coverage WHERE tenant_id=$1', [f.tenantId]))[0].d,
      );
      const [cal] = await h.q('SELECT id FROM fiscal_calendars WHERE tenant_id=$1', [f.tenantId]);
      for (const yr of [y + 1, y + 2]) await h.q('SELECT fn_generate_fiscal_year($1,$2,$3,$4)', [f.tenantId, cal.id, yr, String(yr)]);
      expect(await h.q('SELECT * FROM fn_fin_monitor_m7_fiscal_coverage($1, 180)', [f.tenantId])).toEqual([]);
      // expired calendar => critical
      const g = await h.tenant('m7exp');
      await h.q("SET session_replication_role = 'replica'");
      try {
        await h.q("UPDATE fiscal_years SET end_date = (CURRENT_DATE - 5), start_date = (CURRENT_DATE - 370) WHERE tenant_id=$1", [g.tenantId]);
      } finally {
        await h.q("SET session_replication_role = 'origin'");
      }
      const exp = await h.q('SELECT * FROM fn_fin_monitor_m7_fiscal_coverage($1, 180)', [g.tenantId]);
      expect(exp.map((r) => r.severity)).toEqual(['critical']);
    });

    it('M-8: identical double submit under different sale_attempt_ids is flagged once; different lines are not; missing invoice number after numbering started is flagged', async () => {
      const f = await h.tenant('m8');
      const a = await h.item(f, 'A');
      const b = await h.item(f, 'B');
      await h.receive(f, a, 20, 7);
      await h.receive(f, b, 20, 7);
      const s1 = await h.runSale(f, [{ itemId: a, qty: 1, price: 20 }], { mode: 'pooled_stock_on' });
      const s2 = await h.runSale(f, [{ itemId: a, qty: 1, price: 20 }], { mode: 'pooled_stock_on' }); // double submit
      const s3 = await h.runSale(f, [{ itemId: b, qty: 1, price: 20 }], { mode: 'pooled_stock_on' }); // same total, other item
      if (!s1.ok || !s2.ok || !s3.ok) throw new Error('setup');
      const dup = (await mon(f, 'M-8')).filter((r) => r.detail.kind === 'near_duplicate');
      expect(dup).toHaveLength(1);
      expect(dup[0].subject_id).toBe(s2.id);
      expect(dup[0].detail.duplicate_of).toBe(s1.id);
      // numbering: s1 gets a number; s2, s3 were created later without one
      await h.q("UPDATE orders SET invoice_no='INV-000001' WHERE id=$1", [s1.id]);
      const miss = (await mon(f, 'M-8')).filter((r) => r.detail.kind === 'missing_invoice_no').map((r) => r.subject_id).sort();
      expect(miss).toEqual([s2.id, s3.id].sort());
    });

    it('M-9: cancel whose stock restore was lost is flagged with qty sold vs restocked; a clean cancel is not', async () => {
      const f = await h.tenant('m9');
      const a = await h.item(f, 'A');
      await h.receive(f, a, 10, 7);
      const good = await h.runSale(f, [{ itemId: a, qty: 1, price: 20 }], { mode: 'pooled_stock_on' });
      const lost = await h.runSale(f, [{ itemId: a, qty: 2, price: 21 }], { mode: 'pooled_stock_on' });
      if (!good.ok || !lost.ok) throw new Error('setup');
      expect((await h.runCancel(f, good.id)).ok).toBe(true);
      expect((await h.runCancel(f, lost.id, { failRestock: true })).ok).toBe(true);
      const rows = await mon(f, 'M-9');
      expect(rows.map((r) => r.subject_id)).toEqual([lost.id]);
      expect(rows[0].detail).toMatchObject({ qty_sold: 2, qty_restocked: 0, entry_not_reversed: false });
    });

    it('summary aggregates per check and severity', async () => {
      const f = await h.tenant('msum');
      const a = await h.item(f, 'A');
      await h.receive(f, a, 10, 7);
      await h.runSale(f, [{ itemId: a, qty: 2, price: 20 }], { mode: 'pooled_off' });
      const rows = await h.q("SELECT * FROM fn_fin_monitor_summary($1, '0 seconds')", [f.tenantId]);
      const k = (c: string, s: string) => rows.find((r) => r.check_id === c && r.severity === s);
      expect(Number(k('M-1', 'critical').findings)).toBe(1);
      expect(Number(k('M-4', 'high').findings)).toBe(1);
    });
  });

  describe('read-only, privileges, rollback', () => {
    const names = async () =>
      (await h.q("SELECT oid::regprocedure::text n, provolatile v, prosecdef sd FROM pg_proc WHERE proname LIKE 'fn\\_fin\\_monitor\\_%' ORDER BY 1")) as any[];

    it('every monitor is STABLE and SECURITY INVOKER; only service_role may execute', async () => {
      const fns = await names();
      expect(fns).toHaveLength(11);
      for (const fn of fns) {
        expect(fn.v).toBe('s');
        expect(fn.sd).toBe(false);
        const [g] = await h.q(
          "SELECT has_function_privilege('anon', $1, 'EXECUTE') a, has_function_privilege('authenticated', $1, 'EXECUTE') u, has_function_privilege('service_role', $1, 'EXECUTE') s, has_function_privilege('public', $1, 'EXECUTE') p",
          [fn.n],
        );
        expect(g).toEqual({ a: false, u: false, s: true, p: false });
      }
    });

    it('all monitors run inside BEGIN READ ONLY as service_role (any write would error) and leave row counts untouched', async () => {
      const f = await h.tenant('mro');
      const a = await h.item(f, 'A');
      await h.receive(f, a, 10, 7);
      await h.runSale(f, [{ itemId: a, qty: 2, price: 20 }], { mode: 'pooled_off' });
      const counts = async () =>
        (await h.q('SELECT (SELECT count(*) FROM orders) o, (SELECT count(*) FROM journal_entries) j, (SELECT count(*) FROM stock_movements) m, (SELECT count(*) FROM stock_levels) l, (SELECT count(*) FROM cost_layers) c'))[0];
      const before = await counts();
      await h.withClient(async (c) => {
        await c.query('BEGIN READ ONLY');
        await c.query('SET LOCAL ROLE service_role');
        const r = await c.query("SELECT * FROM fn_fin_monitor_all($1, '0 seconds')", [f.tenantId]);
        expect(r.rows.length).toBeGreaterThan(0);
        await c.query('SELECT * FROM fn_fin_monitor_summary()');
        await c.query('ROLLBACK');
      });
      // and anon cannot call them
      await expect(
        h.withClient(async (c) => {
          await c.query('BEGIN');
          await c.query('SET LOCAL ROLE anon');
          await c.query('SELECT * FROM fn_fin_monitor_all()');
        }),
      ).rejects.toThrow(/permission denied/);
      expect(await counts()).toEqual(before);
    });

    it('rollback drops exactly the 11 functions; re-apply restores them; applying twice is idempotent', async () => {
      const before = (await names()).map((n) => n.n);
      await h.pg.query(read('rollback', '329_financial_monitoring_ROLLBACK.sql'));
      expect(await names()).toHaveLength(0);
      await h.pg.query(read('329_financial_monitoring.sql'));
      await h.pg.query(read('329_financial_monitoring.sql'));
      expect((await names()).map((n) => n.n)).toEqual(before);
    });
  });
});
