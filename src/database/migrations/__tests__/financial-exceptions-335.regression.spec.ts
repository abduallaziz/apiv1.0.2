/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any */
/**
 * WP-E (migration 335) — durable record + idempotent catch-up of swallowed stock failures in the pooled sale path.
 * Real InvoicesRepository + real posting engine on the LOCAL disposable database. Leaves 335 applied.
 *
 * A "failing line" is an item with costing 'standard' and no standard_cost: fn_consume_cost_layers raises for it (the same
 * trick the 333 spec uses), so the line fails inside the sale transaction while its sibling line is healthy.
 */
import * as fs from 'fs';
import * as path from 'path';
import { createHash, randomUUID } from 'crypto';
import { Harness, Fx } from './support/sale-path-fixtures';

jest.setTimeout(240000);
const PENDING = path.resolve(__dirname, '..', '..', 'migrations_pending');
const read = (...p: string[]) => fs.readFileSync(path.join(PENDING, ...p), 'utf8').replace(/\r/g, '');
const md5 = (s: string) => createHash('md5').update(s).digest('hex');

describe('WP-E 335: financial_exceptions (flag off == today, flag on == per-line + durable record, retry == once)', () => {
  const h = new Harness();

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL (local) required');
    await h.open();
    await h.ensurePending('333_sale_stock_idempotency.sql', '335_financial_exceptions.sql');
  }, 120000);
  afterAll(async () => {
    await h.pg.query(read('333_sale_stock_idempotency.sql'));
    await h.pg.query(read('335_financial_exceptions.sql'));
    await h.close();
  });

  /** tenant with a healthy item A (10 @ 7) and a failing item B (10 @ 7, but no standard cost to consume) */
  async function world(label: string) {
    const f = await h.tenant(label);
    const a = await h.item(f, 'A');
    const b = await h.item(f, 'B', { costing: 'standard', standardCost: null });
    await h.receive(f, a, 10, 7);
    await h.receive(f, b, 10, 7);
    return { f, a, b };
  }
  const exceptions = (f: Fx, orderId?: string) =>
    h.q(
      `SELECT * FROM financial_exceptions WHERE tenant_id=$1 ${orderId ? 'AND source_entity_id=$2' : ''} ORDER BY created_at, id`,
      orderId ? [f.tenantId, orderId] : [f.tenantId],
    );
  const catchups = (f: Fx) =>
    h.q("SELECT * FROM journal_entries WHERE tenant_id=$1 AND source_entity_type='order_cogs_catchup' ORDER BY created_at", [f.tenantId]);
  const retry = (id: string, c?: any) =>
    (c ? c.query('SELECT fn_financial_exception_retry($1) r', [id]) : h.pg.query('SELECT fn_financial_exception_retry($1) r', [id])).then(
      (r: any) => r.rows[0].r as any,
    );
  const fixB = (b: string) => h.q('UPDATE items SET standard_cost=7 WHERE id=$1', [b]);
  const cogsOf = async (entryId: string) => (await h.lines(entryId)).filter((l) => l.code === '5000').reduce((t, l) => t + Number(l.d), 0);

  async function failingSale(label: string, opts: { recordExceptions?: boolean } = { recordExceptions: true }) {
    const w = await world(label);
    const s = await h.runSale(
      w.f,
      [
        { itemId: w.a, qty: 2, price: 20 },
        { itemId: w.b, qty: 1, price: 30 },
      ],
      { mode: 'pooled_stock_on', ...opts },
    );
    if (!s.ok) throw new Error('setup: ' + (s as any).error);
    return { ...w, s };
  }

  // ------------------------------------------------------------------ flag off == today
  it('FLAG OFF: identical to today — whole-order savepoint drops healthy lines, nothing recorded, no new result key', async () => {
    const { f, a, b, s } = await failingSale('off', {});
    expect(s.stockDeducted).toBe(false);
    expect(s.stockError).toBeTruthy();
    expect('stockExceptions' in s && s.stockExceptions !== undefined).toBe(false);
    expect(await h.movements(f, s.id)).toHaveLength(0); // KNOWN today: healthy line A lost its movement too
    expect(await h.onHand(f, a)).toBe(10);
    expect(await h.onHand(f, b)).toBe(10);
    expect(await exceptions(f)).toHaveLength(0);
    const [entry] = await h.entries(f, s.id);
    expect(await cogsOf(entry.id)).toBe(0); // revenue posted without COGS
    expect(await catchups(f)).toHaveLength(0);
  });

  it('FLAG OFF: healthy sale equals FLAG ON healthy sale (same movements, same entry lines, no exception rows)', async () => {
    const out: any[] = [];
    for (const rec of [false, true]) {
      const w = await world(rec ? 'hon' : 'hoff');
      const s = await h.runSale(w.f, [{ itemId: w.a, qty: 2, price: 20 }], { mode: 'pooled_stock_on', recordExceptions: rec });
      if (!s.ok) throw new Error('setup');
      const [entry] = await h.entries(w.f, s.id);
      out.push({
        deducted: s.stockDeducted,
        mv: (await h.movements(w.f, s.id)).map((m) => [Number(m.quantity), Number(m.unit_cost), m.movement_type]),
        lines: (await h.lines(entry.id)).map((l) => [l.code, Number(l.d), Number(l.c)]),
        onHand: await h.onHand(w.f, w.a),
        ex: (await exceptions(w.f)).length,
      });
    }
    expect(out[1]).toEqual(out[0]);
    expect(out[0].deducted).toBe(true);
    expect(out[0].ex).toBe(0);
  });

  // ------------------------------------------------------------------ flag on
  it('FLAG ON: healthy line keeps its movement + COGS, only the failing line is recorded, sale and entry commit', async () => {
    const { f, a, b, s } = await failingSale('on');
    expect(s.stockDeducted).toBe(false);
    expect(s.stockExceptions).toBe(1);
    const mv = await h.movements(f, s.id);
    expect(mv).toHaveLength(1);
    expect(mv[0].item_id).toBe(a);
    expect(await h.onHand(f, a)).toBe(8);
    expect(await h.onHand(f, b)).toBe(10);
    const entries = await h.entries(f, s.id);
    expect(entries).toHaveLength(1);
    expect(await cogsOf(entries[0].id)).toBe(14); // healthy line's COGS is in the sale entry
    expect(await h.entryBalanced(entries[0].id)).toBe(true);
    const ex = await exceptions(f, s.id);
    expect(ex).toHaveLength(1);
    expect(ex[0]).toMatchObject({ kind: 'stock_deduction_failed', status: 'open', source_entity_type: 'order', item_id: b, attempts: 0 });
    expect(Number(ex[0].quantity)).toBe(1);
    expect(ex[0].error_text).toBeTruthy();
    const [oi] = await h.q("SELECT id FROM order_items WHERE order_id=$1 AND item_id=$2", [s.id, b]);
    expect(ex[0].line_ref).toBe(oi.id);
    expect(await h.count('orders', f)).toBe(1);
  });

  it('FLAG ON: two lines of the same failing item are recorded once with the summed quantity', async () => {
    const w = await world('dup');
    const s = await h.runSale(
      w.f,
      [
        { itemId: w.b, qty: 1, price: 30 },
        { itemId: w.b, qty: 2, price: 30 },
      ],
      { mode: 'pooled_stock_on', recordExceptions: true },
    );
    if (!s.ok) throw new Error('setup');
    const ex = await exceptions(w.f, s.id);
    expect(ex).toHaveLength(1);
    expect(Number(ex[0].quantity)).toBe(3);
  });

  it('FLAG ON: a sale that fails posting (closed period) leaves no order, no movement, no exception row', async () => {
    const w = await world('atomic');
    await h.q("UPDATE fiscal_periods SET status='closed' WHERE tenant_id=$1", [w.f.tenantId]);
    const s = await h.runSale(
      w.f,
      [
        { itemId: w.a, qty: 2, price: 20 },
        { itemId: w.b, qty: 1, price: 30 },
      ],
      { mode: 'pooled_stock_on', recordExceptions: true },
    );
    expect(s.ok).toBe(false);
    expect(await h.count('orders', w.f)).toBe(0);
    expect((await h.q("SELECT count(*)::int n FROM stock_movements WHERE tenant_id=$1 AND movement_type='sale'", [w.f.tenantId]))[0].n).toBe(0);
    expect(await exceptions(w.f)).toHaveLength(0);
  });

  it('REPLAY: same sale_attempt_id cannot create a second order, movement or exception; recorder and line deduction are idempotent', async () => {
    const w = await world('replay');
    const attemptId = randomUUID();
    const lines = [
      { itemId: w.a, qty: 2, price: 20 },
      { itemId: w.b, qty: 1, price: 30 },
    ];
    const first = await h.runSale(w.f, lines, { mode: 'pooled_stock_on', recordExceptions: true, attemptId });
    if (!first.ok) throw new Error('setup');
    const second = await h.runSale(w.f, lines, { mode: 'pooled_stock_on', recordExceptions: true, attemptId });
    expect(second.ok).toBe(false); // uq_orders_tenant_sale_attempt
    expect(await h.count('orders', w.f)).toBe(1);
    expect(await exceptions(w.f)).toHaveLength(1);
    expect(await h.movements(w.f, first.id)).toHaveLength(1);
    // direct replays at the SQL level
    const [ex] = await exceptions(w.f, first.id);
    for (let i = 0; i < 3; i++) {
      await h.q('SELECT fn_record_financial_exception($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [
        w.f.tenantId, 'stock_deduction_failed', 'order', first.id, null, ex.item_id, null, 1, w.f.warehouseId, 'again',
      ]);
      await h.q('SELECT fn_process_sale_stock_deduction_line($1,$2,$3,NULL,$4,NULL,2)', [w.f.tenantId, w.f.warehouseId, first.id, w.a]);
    }
    expect(await exceptions(w.f)).toHaveLength(1);
    expect(await h.movements(w.f, first.id)).toHaveLength(1);
    expect(await h.onHand(w.f, w.a)).toBe(8);
  });

  // ------------------------------------------------------------------ retry
  it('RETRY: still failing -> stays open, attempts++, nothing written (atomic); then fixed -> resolves once, COGS posted once', async () => {
    const { f, a, b, s } = await failingSale('retry');
    const [ex] = await exceptions(f, s.id);
    const r0 = await retry(ex.id);
    expect(r0.status).toBe('failed');
    const [afterFail] = await exceptions(f, s.id);
    expect(afterFail).toMatchObject({ status: 'open', attempts: 1 });
    expect(afterFail.last_error).toBeTruthy();
    expect(await h.movements(f, s.id)).toHaveLength(1);
    expect(await catchups(f)).toHaveLength(0);

    await fixB(b);
    const before = await h.balances(f);
    const r1 = await retry(ex.id);
    expect(r1.status).toBe('resolved');
    expect(Number(r1.amount)).toBe(7);
    const [done] = await exceptions(f, s.id);
    expect(done).toMatchObject({ status: 'resolved', attempts: 2, last_error: null });
    expect(done.resolved_at).toBeTruthy();
    expect(done.catchup_entry_id).toBe(r1.catchup_entry_id);
    expect(await h.movements(f, s.id)).toHaveLength(2);
    expect(await h.onHand(f, b)).toBe(9);
    expect(await h.onHand(f, a)).toBe(8);
    const cu = await catchups(f);
    expect(cu).toHaveLength(1);
    expect(cu[0]).toMatchObject({ status: 'posted', source_module: 'sales', source_entity_id: ex.id });
    expect((await h.lines(cu[0].id)).map((l) => [l.code, Number(l.d), Number(l.c)])).toEqual([['5000', 7, 0], ['1200', 0, 7]]);
    const after = await h.balances(f);
    expect(after['5000']).toBe((before['5000'] ?? 0) + 7);
    expect(after['1200']).toBe((before['1200'] ?? 0) - 7);
    // the sale's own entry is untouched
    expect(await h.entries(f, s.id)).toHaveLength(1);

    // second retry: no-op
    const r2 = await retry(ex.id);
    expect(r2.status).toBe('already_resolved');
    expect(await catchups(f)).toHaveLength(1);
    expect(await h.movements(f, s.id)).toHaveLength(2);
    expect(await h.onHand(f, b)).toBe(9);
    expect((await h.balances(f))['5000']).toBe(after['5000']);
  });

  it('RETRY: closed fiscal period of the sale is refused, exception stays open, nothing written; reopened -> resolves', async () => {
    const { f, b, s } = await failingSale('closedretry');
    await fixB(b);
    const [ex] = await exceptions(f, s.id);
    await h.q("UPDATE fiscal_periods SET status='closed' WHERE tenant_id=$1", [f.tenantId]);
    const r = await retry(ex.id);
    expect(r.status).toBe('refused_closed_period');
    const [row] = await exceptions(f, s.id);
    expect(row).toMatchObject({ status: 'open', attempts: 1 });
    expect(row.last_error).toMatch(/closed/);
    expect(await h.movements(f, s.id)).toHaveLength(1);
    expect(await catchups(f)).toHaveLength(0);
    await h.q("UPDATE fiscal_periods SET status='open' WHERE tenant_id=$1", [f.tenantId]);
    expect((await retry(ex.id)).status).toBe('resolved');
    expect(await catchups(f)).toHaveLength(1);
  });

  it('RETRY: two concurrent retries -> exactly one wins, one movement, one catch-up entry', async () => {
    const { f, b, s } = await failingSale('conc');
    await fixB(b);
    const [ex] = await exceptions(f, s.id);
    const res: any[] = await Promise.all([0, 1, 2].map(() => h.withClient((c) => retry(ex.id, c))));
    expect(res.map((r) => r.status).sort()).toEqual(['already_resolved', 'already_resolved', 'resolved']);
    expect(await h.movements(f, s.id)).toHaveLength(2);
    expect(await catchups(f)).toHaveLength(1);
    expect(await h.onHand(f, b)).toBe(9);
  });

  it('RETRY BATCH: limit respected, oldest first, tenant filter, resolved rows are not touched again', async () => {
    const w = await world('batch');
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const s = await h.runSale(w.f, [{ itemId: w.b, qty: 1, price: 30 }], { mode: 'pooled_stock_on', recordExceptions: true });
      if (!s.ok) throw new Error('setup');
      ids.push((await exceptions(w.f, s.id))[0].id);
    }
    await fixB(w.b);
    const r1 = (await h.q('SELECT * FROM fn_financial_exception_retry_batch(2, $1)', [w.f.tenantId])) as any[];
    expect(r1).toHaveLength(2);
    expect(r1.map((r) => r.exception_id)).toEqual(ids.slice(0, 2));
    expect(r1.every((r) => r.status === 'resolved')).toBe(true);
    const r2 = (await h.q('SELECT * FROM fn_financial_exception_retry_batch(10, $1)', [w.f.tenantId])) as any[];
    expect(r2.map((r) => r.exception_id)).toEqual([ids[2]]);
    expect(await h.q('SELECT * FROM fn_financial_exception_retry_batch(10, $1)', [w.f.tenantId])).toHaveLength(0);
    expect(await catchups(w.f)).toHaveLength(3);
    // another tenant's open exceptions are not touched by a tenant-filtered batch
    const o = await failingSale('batch-other');
    expect(await h.q('SELECT * FROM fn_financial_exception_retry_batch(10, $1)', [w.f.tenantId])).toHaveLength(0);
    expect((await exceptions(o.f))[0].status).toBe('open');
  });

  // ------------------------------------------------------------------ cancel
  it('CANCEL (flag on): restock happens in the cancel transaction; open exception is closed; no catch-up needed', async () => {
    const { f, a, b, s } = await failingSale('cancelopen');
    const c = await h.runCancel(f, s.id, { recordExceptions: true });
    expect(c.ok).toBe(true);
    expect((c as any).upd.restockHandled).toBe(true);
    expect(await h.onHand(f, a)).toBe(10);
    expect(await h.onHand(f, b)).toBe(10);
    const [ex] = await exceptions(f, s.id);
    expect(ex).toMatchObject({ status: 'resolved' });
    expect(ex.resolution_note).toMatch(/cancelled/);
    expect(await h.movements(f, s.id, 'sale_return')).toHaveLength(1);
    // retry after cancel is a clean no-op (already resolved)
    expect((await retry(ex.id)).status).toBe('already_resolved');
  });

  it('CANCEL (flag on) after the catch-up was posted: stock fully restored AND the catch-up COGS is reversed (no phantom COGS)', async () => {
    const { f, a, b, s } = await failingSale('cancelafter');
    await fixB(b);
    const [ex] = await exceptions(f, s.id);
    expect((await retry(ex.id)).status).toBe('resolved');
    const c = await h.runCancel(f, s.id, { recordExceptions: true });
    expect(c.ok).toBe(true);
    expect(await h.onHand(f, a)).toBe(10);
    expect(await h.onHand(f, b)).toBe(10);
    const bal = await h.balances(f);
    expect(bal['5000'] ?? 0).toBe(0);
    expect(bal['4000'] ?? 0).toBe(0);
    const cu = await catchups(f);
    expect(cu.filter((e) => e.reversal_of_id === null)).toHaveLength(1);
    expect(cu.filter((e) => e.reversal_of_id !== null)).toHaveLength(1);
  });

  it('CANCEL (flag on): a failing restock is recorded durably (same tx), the cancel still commits; retry restocks once', async () => {
    const w = await world('cancelfail');
    const s = await h.runSale(w.f, [{ itemId: w.a, qty: 2, price: 20 }], { mode: 'pooled_stock_on', recordExceptions: true });
    if (!s.ok) throw new Error('setup');
    const sqlFn = (await h.q("SELECT pg_get_functiondef(oid) d FROM pg_proc WHERE proname='fn_reverse_sale_stock_deduction' AND pronamespace='public'::regnamespace"))[0].d as string;
    await h.pg.query(
      "CREATE OR REPLACE FUNCTION public.fn_reverse_sale_stock_deduction(p_tenant_id uuid, p_order_id uuid, p_actor_id uuid) RETURNS void LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'simulated restock failure'; END $f$",
    );
    let c: any;
    try {
      c = await h.runCancel(w.f, s.id, { recordExceptions: true });
    } finally {
      await h.pg.query(sqlFn);
    }
    expect(c.ok).toBe(true);
    expect(c.upd.status).toBe('cancelled');
    expect(c.upd.restockHandled).toBe(true);
    expect(await h.onHand(w.f, w.a)).toBe(8); // not restocked yet
    const [ex] = await exceptions(w.f, s.id);
    expect(ex).toMatchObject({ kind: 'restock_failed', status: 'open' });
    expect(ex.error_text).toMatch(/simulated/);
    expect((await retry(ex.id)).status).toBe('resolved');
    expect(await h.onHand(w.f, w.a)).toBe(10);
    expect((await retry(ex.id)).status).toBe('already_resolved');
    expect(await h.onHand(w.f, w.a)).toBe(10);
    expect(await h.movements(w.f, s.id, 'sale_return')).toHaveLength(1);
  });

  it('CANCEL (flag off): unchanged — result has no restockHandled, separate restock still does the work', async () => {
    const w = await world('canceloff');
    const s = await h.runSale(w.f, [{ itemId: w.a, qty: 2, price: 20 }], { mode: 'pooled_stock_on' });
    if (!s.ok) throw new Error('setup');
    const c = await h.runCancel(w.f, s.id);
    expect(c.ok).toBe(true);
    expect('restockHandled' in (c as any).upd).toBe(false);
    expect(await h.onHand(w.f, w.a)).toBe(10);
  });

  // ------------------------------------------------------------------ monitors, grants
  it('MONITORS: M-10 lists open exceptions, fn_fin_monitor_summary still works read-only and counts them; resolved rows disappear', async () => {
    const { f, b, s } = await failingSale('mon');
    const [ex] = await exceptions(f, s.id);
    const all = await h.q('SELECT * FROM fn_fin_monitor_all($1)', [f.tenantId]);
    const m10 = all.filter((r) => r.check_id === 'M-10');
    expect(m10).toHaveLength(1);
    expect(m10[0]).toMatchObject({ severity: 'high', subject_type: 'financial_exception', subject_id: ex.id });
    expect(m10[0].detail).toMatchObject({ kind: 'stock_deduction_failed', source_entity_id: s.id });
    await h.withClient(async (c) => {
      await c.query('BEGIN READ ONLY');
      await c.query('SET LOCAL ROLE service_role');
      const sum = await c.query('SELECT * FROM fn_fin_monitor_summary($1)', [f.tenantId]);
      await c.query('ROLLBACK');
      expect(sum.rows.find((r: any) => r.check_id === 'M-10')).toMatchObject({ severity: 'high', findings: '1' });
    });
    await fixB(b);
    await retry(ex.id);
    expect((await h.q('SELECT * FROM fn_fin_monitor_all($1)', [f.tenantId])).filter((r) => r.check_id === 'M-10')).toHaveLength(0);
  });

  it('GRANTS / RLS: service_role only; anon and authenticated have nothing; RLS enabled with tenant policy', async () => {
    const t = await h.q("SELECT has_table_privilege('service_role','financial_exceptions','SELECT') s, has_table_privilege('service_role','financial_exceptions','UPDATE') u, has_table_privilege('anon','financial_exceptions','SELECT') a, has_table_privilege('authenticated','financial_exceptions','INSERT') au");
    expect(t[0]).toEqual({ s: true, u: true, a: false, au: false });
    for (const fn of ['fn_financial_exception_retry(uuid,uuid)', 'fn_financial_exception_retry_batch(integer,uuid,uuid)', 'fn_record_financial_exception(uuid,text,text,uuid,uuid,uuid,uuid,numeric,uuid,text)', 'fn_process_sale_stock_deduction_line(uuid,uuid,uuid,uuid,uuid,uuid,numeric)', 'fn_financial_exception_on_order_cancel(uuid,uuid,uuid,date)', 'fn_fin_monitor_m10_open_exceptions(uuid,interval,interval)']) {
      const r = await h.q("SELECT has_function_privilege('service_role',$1,'EXECUTE') s, has_function_privilege('anon',$1,'EXECUTE') a, has_function_privilege('authenticated',$1,'EXECUTE') au", [fn]);
      expect(r[0]).toEqual({ s: true, a: false, au: false });
    }
    const [rls] = await h.q("SELECT relrowsecurity r FROM pg_class WHERE relname='financial_exceptions'");
    expect(rls.r).toBe(true);
    expect((await h.q("SELECT polname FROM pg_policy WHERE polrelid='financial_exceptions'::regclass")).map((r) => r.polname)).toEqual(['tenant_session_isolation']);
    // unique dedupe key + status/time consistency enforced by the database
    const w = await world('constraints');
    await expect(
      h.q("INSERT INTO financial_exceptions (tenant_id,kind,source_entity_type,source_entity_id,dedupe_key,status) VALUES ($1,'cogs_missing','order',$2,'k','resolved')", [w.f.tenantId, randomUUID()]),
    ).rejects.toThrow(/chk_financial_exceptions_resolved/);
  });

  // ------------------------------------------------------------------ rollback, fallback (LAST: toggles 335)
  it('ROLLBACK 335: refuses with open rows; restores the exact 329 body (hash), drops table + functions; flag-on sale still works without 335; re-apply is clean', async () => {
    const hashAll = async () =>
      (await h.q("SELECT md5(replace(prosrc, chr(13), '')) h FROM pg_proc WHERE proname='fn_fin_monitor_all' AND pronamespace='public'::regnamespace"))[0].h as string;
    const withEx = await failingSale('rbopen');
    await expect(h.pg.query(read('rollback', '335_financial_exceptions_ROLLBACK.sql'))).rejects.toThrow(/open financial_exceptions exist/);
    expect((await exceptions(withEx.f)).length).toBe(1); // nothing destroyed

    const withM10 = await hashAll();
    await h.q("UPDATE financial_exceptions SET status='resolved', resolved_at=now()"); // resolve everything so rollback may proceed
    await h.pg.query(read('rollback', '335_financial_exceptions_ROLLBACK.sql'));
    const m = /CREATE OR REPLACE FUNCTION fn_fin_monitor_all\([\s\S]*?AS \$\$([\s\S]*?)\$\$;/.exec(read('329_financial_monitoring.sql'));
    expect(await hashAll()).toBe(md5(m![1]));
    expect(await hashAll()).not.toBe(withM10);
    expect((await h.q("SELECT to_regclass('public.financial_exceptions') t"))[0].t).toBeNull();
    const left = await h.q("SELECT proname FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('fn_financial_exception_retry','fn_financial_exception_retry_batch','fn_record_financial_exception','fn_process_sale_stock_deduction_line','fn_financial_exception_on_order_cancel','fn_fin_monitor_m10_open_exceptions')");
    expect(left).toHaveLength(0);
    expect((await h.q('SELECT count(*)::int n FROM fn_fin_monitor_summary()'))[0].n).toBeGreaterThanOrEqual(0); // 329 intact

    // flag ON while 335 is absent: falls back to today's behaviour, the sale is NOT lost
    const w = await world('fallback');
    const s = await h.runSale(w.f, [{ itemId: w.a, qty: 2, price: 20 }], { mode: 'pooled_stock_on', recordExceptions: true });
    expect(s.ok).toBe(true);
    if (s.ok) {
      expect(s.stockDeducted).toBe(true); // all-or-nothing path, deduction succeeded
      expect(await h.movements(w.f, s.id)).toHaveLength(1);
      expect(await h.entries(w.f, s.id)).toHaveLength(1);
    }
    const w2 = await world('fallback2');
    const s2 = await h.runSale(w2.f, [{ itemId: w2.a, qty: 2, price: 20 }, { itemId: w2.b, qty: 1, price: 30 }], { mode: 'pooled_stock_on', recordExceptions: true });
    expect(s2.ok).toBe(true);
    if (s2.ok) expect(s2.stockDeducted).toBe(false); // old behaviour: whole-order drop + post-commit retry
    const c = await h.runCancel(w.f, (s as any).id, { recordExceptions: true });
    expect(c.ok).toBe(true);
    expect(await h.onHand(w.f, w.a)).toBe(10); // old best-effort restock ran

    await h.pg.query(read('335_financial_exceptions.sql'));
    await h.pg.query(read('335_financial_exceptions.sql')); // idempotent re-apply
    expect(await hashAll()).toBe(withM10);
  });
});
