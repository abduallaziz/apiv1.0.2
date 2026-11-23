/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any */
/**
 * Review follow-ups for WP-E (335) and the migration ordering guards. LOCAL DISPOSABLE DATABASE ONLY.
 *  1. cancel posting date: the API passes NULL so the 328 policy decides (tenant-local date), never the UTC date.
 *  3. retry vs cancel race: no deducted stock / live catch-up COGS survives.
 *  4. ordering guards: 332 and 335 refuse to apply when 328 is not applied.
 * Leaves 328, 332, 333, 335 applied.
 *
 * The clock cannot be faked inside PostgreSQL, so the date-boundary tests pick the tenant time zone whose local date
 * differs from today's UTC date (+14:00 or -11:00: at least one always differs). That reproduces exactly the mechanism of a
 * Riyadh tenant between 00:00 and 03:00 local (local date ahead of UTC date).
 */
import * as fs from 'fs';
import * as path from 'path';
import { Harness, Fx } from './support/sale-path-fixtures';

jest.setTimeout(240000);
const PENDING = path.resolve(__dirname, '..', '..', 'migrations_pending');
const read = (...p: string[]) => fs.readFileSync(path.join(PENDING, ...p), 'utf8').replace(/\r/g, '');
const WIRING = ['325_fiscal_year_continuity.sql', '326_fiscal_period_safety_net.sql', '327_posting_date_policy.sql', '328_posting_date_policy_wiring.sql'];

describe('WP-E review follow-ups (335)', () => {
  const h = new Harness();

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL (local) required');
    await h.open();
    await h.ensurePending('332_sales_return_tax_inclusive_share.sql', '333_sale_stock_idempotency.sql', '335_financial_exceptions.sql');
  }, 120000);
  afterAll(async () => {
    await h.pg.query(read('333_sale_stock_idempotency.sql'));
    await h.pg.query(read('335_financial_exceptions.sql'));
    await h.q("UPDATE financial_exceptions SET status='resolved', resolved_at=now(), resolution_note='review spec: test cleanup' WHERE status='open'");
    await h.close();
  });

  async function offsetTz(): Promise<string> {
    const [r] = await h.q(
      `SELECT CASE WHEN (now() AT TIME ZONE 'Pacific/Kiritimati')::date <> (now() AT TIME ZONE 'UTC')::date THEN 'Pacific/Kiritimati' ELSE 'Pacific/Pago_Pago' END tz,
              ((now() AT TIME ZONE 'Pacific/Pago_Pago')::date <> (now() AT TIME ZONE 'UTC')::date) OR ((now() AT TIME ZONE 'Pacific/Kiritimati')::date <> (now() AT TIME ZONE 'UTC')::date) ok`,
    );
    expect(r.ok).toBe(true);
    return r.tz;
  }
  async function world(label: string, tz?: string) {
    const f = await h.tenant(label);
    if (tz) await h.q('UPDATE tenants SET timezone=$2 WHERE id=$1', [f.tenantId, tz]);
    const a = await h.item(f, 'A');
    const b = await h.item(f, 'B', { costing: 'standard', standardCost: null });
    await h.receive(f, a, 10, 7);
    await h.receive(f, b, 10, 7);
    return { f, a, b };
  }
  const iso = (d: any) => (d instanceof Date ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : String(d).slice(0, 10));
  const entryDates = async (f: Fx, orderId: string, type = 'order') =>
    (await h.q("SELECT reversal_of_id, to_char(posting_date,'YYYY-MM-DD') d FROM journal_entries WHERE tenant_id=$1 AND source_entity_type=$2 AND source_entity_id=$3 ORDER BY created_at", [f.tenantId, type, orderId])) as { reversal_of_id: string | null; d: string }[];
  const exceptions = (f: Fx, orderId: string) => h.q('SELECT * FROM financial_exceptions WHERE tenant_id=$1 AND source_entity_id=$2', [f.tenantId, orderId]);

  // ------------------------------------------------------------------ 1. cancel posting date
  it.each([false, true])('CANCEL DATE (flag %s): reversal lands on the sale entry\'s tenant-local date (policy), not the UTC date', async (rec) => {
    const tz = await offsetTz();
    const w = await world('tz' + rec, tz);
    const s = await h.runSale(w.f, [{ itemId: w.a, qty: 2, price: 20 }], { mode: 'pooled_stock_on', recordExceptions: rec });
    if (!s.ok) throw new Error('setup: ' + (s as any).error);
    const [{ local, utc }] = await h.q("SELECT to_char(now() AT TIME ZONE $1,'YYYY-MM-DD') local, to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD') utc", [tz]);
    expect(local).not.toBe(utc);
    const c = await h.runCancel(w.f, s.id, { recordExceptions: rec });
    expect(c.ok).toBe(true);
    const e = await entryDates(w.f, s.id);
    expect(e).toHaveLength(2);
    expect(e[0].d).toBe(local); // the sale posted on the tenant-local date
    expect(e[1].reversal_of_id).not.toBeNull();
    expect(e[1].d).toBe(e[0].d); // reversal: same day as the entry it reverses, never earlier
  });

  it('CANCEL DATE (flag on): the catch-up COGS reversal also follows the policy date', async () => {
    const tz = await offsetTz();
    const w = await world('tzcatch', tz);
    const s = await h.runSale(w.f, [{ itemId: w.a, qty: 2, price: 20 }, { itemId: w.b, qty: 1, price: 30 }], { mode: 'pooled_stock_on', recordExceptions: true });
    if (!s.ok) throw new Error('setup');
    await h.q('UPDATE items SET standard_cost=7 WHERE id=$1', [w.b]);
    const [ex] = await exceptions(w.f, s.id);
    expect((await h.q('SELECT fn_financial_exception_retry($1) r', [ex.id]))[0].r.status).toBe('resolved');
    expect((await h.runCancel(w.f, s.id, { recordExceptions: true })).ok).toBe(true);
    const cu = await entryDates(w.f, s.id, 'order_cogs_catchup').catch(() => []);
    const rows = await h.q("SELECT reversal_of_id, to_char(posting_date,'YYYY-MM-DD') d FROM journal_entries WHERE tenant_id=$1 AND source_entity_type='order_cogs_catchup' ORDER BY created_at", [w.f.tenantId]);
    expect(cu).toBeDefined();
    expect(rows).toHaveLength(2);
    expect(rows[1].d).toBe(rows[0].d);
    const sale = await entryDates(w.f, s.id);
    expect(sale[1].d).toBe(rows[1].d); // both reversals share one date/period
  });

  it('CANCEL DATE: SQL contract — fn_financial_exception_on_order_cancel(NULL) derives the date from the policy; explicit date honoured', async () => {
    const tz = await offsetTz();
    const w = await world('tzsql', tz);
    const s = await h.runSale(w.f, [{ itemId: w.a, qty: 2, price: 20 }, { itemId: w.b, qty: 1, price: 30 }], { mode: 'pooled_stock_on', recordExceptions: true });
    if (!s.ok) throw new Error('setup');
    await h.q('UPDATE items SET standard_cost=7 WHERE id=$1', [w.b]);
    const [ex] = await exceptions(w.f, s.id);
    await h.q('SELECT fn_financial_exception_retry($1)', [ex.id]);
    await h.q("UPDATE orders SET status='cancelled' WHERE id=$1", [s.id]);
    const [{ n }] = await h.q('SELECT fn_financial_exception_on_order_cancel($1,$2,NULL,NULL::date) n', [w.f.tenantId, s.id]);
    expect(n).toBe(1);
    const rows = await h.q("SELECT reversal_of_id, to_char(posting_date,'YYYY-MM-DD') d FROM journal_entries WHERE tenant_id=$1 AND source_entity_type='order_cogs_catchup' ORDER BY created_at", [w.f.tenantId]);
    expect(rows[1].d).toBe(rows[0].d);
  });

  // ------------------------------------------------------------------ 3. race
  async function failingSale(label: string) {
    const w = await world(label);
    const s = await h.runSale(w.f, [{ itemId: w.a, qty: 2, price: 20 }, { itemId: w.b, qty: 1, price: 30 }], { mode: 'pooled_stock_on', recordExceptions: true });
    if (!s.ok) throw new Error('setup');
    await h.q('UPDATE items SET standard_cost=7 WHERE id=$1', [w.b]);
    const [ex] = await exceptions(w.f, s.id);
    return { ...w, s, ex };
  }
  async function invariants(w: { f: Fx; a: string; b: string; s: { id: string } }) {
    expect(await h.onHand(w.f, w.a)).toBe(10);
    expect(await h.onHand(w.f, w.b)).toBe(10);
    const bal = await h.balances(w.f);
    expect(bal['5000'] ?? 0).toBe(0);
    expect(bal['1200'] ?? 0).toBe(0);
    const live = await h.q("SELECT count(*)::int n FROM journal_entries je WHERE je.tenant_id=$1 AND je.source_entity_type='order_cogs_catchup' AND je.status='posted' AND je.reversal_of_id IS NULL", [w.f.tenantId]);
    expect(live[0].n).toBe(0);
  }

  it('RACE (deterministic): cancel holds the order lock, retry waits, then does nothing — no stock or COGS survives', async () => {
    const w = await failingSale('race1');
    const cancelConn = await h.withClient(async (cc) => {
      await cc.query('BEGIN');
      // exactly what cancelPooled does first: lock + status change, then reversal/restock/hygiene, all uncommitted
      await cc.query("UPDATE orders SET status='cancelled', cancelled_at=now() WHERE id=$1", [w.s.id]);
      await cc.query('SELECT fn_reverse_sales_order($1,$2,NULL,NULL,$3)', [w.f.tenantId, w.s.id, 'race']);
      await cc.query('SELECT fn_financial_exception_on_order_cancel($1,$2,NULL,NULL::date)', [w.f.tenantId, w.s.id]);
      await cc.query('SELECT fn_reverse_sale_stock_deduction($1,$2,NULL)', [w.f.tenantId, w.s.id]);
      // the retry starts now, from another connection, while the cancel is still open
      const retry = h.withClient((rc) => rc.query('SELECT fn_financial_exception_retry($1) r', [w.ex.id]).then((r: any) => r.rows[0].r));
      await new Promise((r) => setTimeout(r, 600));
      const waiting = await h.q("SELECT count(*)::int n FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%fn_financial_exception_retry%'");
      expect(waiting[0].n).toBeGreaterThanOrEqual(1); // the retry is blocked behind the cancel
      await cc.query('COMMIT');
      return retry;
    });
    expect((cancelConn as any).status).toBe('already_resolved'); // the cancel's hygiene closed the row; the retry did nothing
    await invariants(w);
    const [ex] = await exceptions(w.f, w.s.id);
    expect(ex.status).toBe('resolved');
  });

  it('RACE (loop): cancel and retry started together, 6 rounds — invariants hold every time', async () => {
    for (let i = 0; i < 6; i++) {
      const w = await failingSale('race-loop-' + i);
      const [r, c] = await Promise.all([
        h.withClient((rc) => rc.query('SELECT fn_financial_exception_retry($1) r', [w.ex.id]).then((x: any) => x.rows[0].r)),
        h.runCancel(w.f, w.s.id, { recordExceptions: true }),
      ]);
      expect(c.ok).toBe(true);
      expect(['resolved', 'already_resolved']).toContain((r as any).status);
      await invariants(w);
    }
  });

  // ------------------------------------------------------------------ 4. ordering guards
  it('ORDER GUARD: 332 and 335 refuse to apply while 328 is not applied; applying 328 again (then 332) restores the chain', async () => {
    const hash = async () =>
      (await h.q("SELECT proname, md5(replace(prosrc, chr(13), '')) h FROM pg_proc WHERE proname IN ('fn_create_sales_return','fn_reverse_sales_order','fn_post_sales_order') AND pronamespace='public'::regnamespace ORDER BY 1")).map((r) => r.h);
    const wired = await hash();
    await h.pg.query(read('rollback', '328_posting_date_policy_wiring_ROLLBACK.sql'));
    await expect(h.pg.query(read('332_sales_return_tax_inclusive_share.sql'))).rejects.toThrow(/328/);
    await expect(h.pg.query(read('335_financial_exceptions.sql'))).rejects.toThrow(/328/);
    // the refused applies changed nothing
    expect((await h.q("SELECT prosrc LIKE '%fn_posting_date_for_event%' w FROM pg_proc WHERE proname='fn_create_sales_return' AND pronamespace='public'::regnamespace"))[0].w).toBe(false);
    await h.pg.query(read('328_posting_date_policy_wiring.sql'));
    await h.pg.query(read('332_sales_return_tax_inclusive_share.sql'));
    await h.pg.query(read('335_financial_exceptions.sql'));
    expect(await hash()).toEqual(wired);
  });

  it('ORDER GUARD (text): 328 header forbids re-running after 332; every rollback header carries the strict reverse order', () => {
    expect(read('328_posting_date_policy_wiring.sql')).toMatch(/NEVER re-run 328 after 332/);
    for (const f of fs.readdirSync(path.join(PENDING, 'rollback')).filter((x) => /^(328|329|330|331|332|333|335)_/.test(x))) {
      expect(read('rollback', f)).toMatch(/ROLLBACK ORDER[^\n]*335, 333, 332, 330, 328, 327, 326, 325/);
    }
    expect(WIRING).toHaveLength(4);
  });
});
