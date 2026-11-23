/**
 * WP-B — fiscal-year continuity + sale integrity at the year boundary.
 *
 * LOCAL DISPOSABLE DATABASE ONLY (`npm run test:integration:local`). Refuses to run
 * unless DATABASE_URL is loopback. Requires migrations 325 and 326 (both authored in
 * src/database/migrations_pending/) on the local database.
 *
 * Disclosed leftovers: fiscal years/periods are append-only (migration 179) and journal
 * entries that were posted are immutable (migration 182), so the tenants this suite
 * creates cannot be deleted. They are tagged with the run id and exist only in the
 * disposable local database.
 */
import * as fs from 'fs';
import * as path from 'path';
import { Client as PgClient } from 'pg';
import { randomUUID } from 'crypto';

const LOOPBACK = ['127.0.0.1', 'localhost', '::1', '[::1]'];
const RUN = `fy-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const ENGINE_ERROR = /No fiscal period covers posting date/;

describe('WP-B fiscal-year continuity and year-boundary sale integrity', () => {
  let pg: PgClient;
  let originalEngineSql: string;
  const url = () => process.env.DATABASE_URL as string;

  async function q<T = any>(sql: string, p: unknown[] = []): Promise<T[]> {
    return (await pg.query(sql, p)).rows as T[];
  }
  async function withClient<T>(fn: (c: PgClient) => Promise<T>): Promise<T> {
    const c = new PgClient({ connectionString: url() });
    await c.connect();
    try {
      return await fn(c);
    } finally {
      await c.end();
    }
  }

  interface Fixture {
    tenantId: string;
    branchId: string;
    calendarId: string;
  }

  /** Tenant with a complete accounting bootstrap for an explicit calendar year (deterministic). */
  async function makeTenant(
    opts: {
      year?: number;
      startMonth?: number;
      tz?: string;
      label?: string;
    } = {},
  ): Promise<Fixture> {
    const year = opts.year ?? 2026;
    const startMonth = opts.startMonth ?? 1;
    const tenantId = randomUUID();
    const branchId = randomUUID();
    await q(
      'INSERT INTO tenants (id, name, business_type, status, timezone) VALUES ($1,$2,$3,$4,$5)',
      [
        tenantId,
        `${RUN}-${opts.label ?? 't'}`,
        'retail',
        'active',
        opts.tz ?? 'Asia/Riyadh',
      ],
    );
    await q('INSERT INTO branches (id, tenant_id, name) VALUES ($1,$2,$3)', [
      branchId,
      tenantId,
      'Main',
    ]);
    const [owner] = await q<{ id: string }>(
      "INSERT INTO accounting_owners (tenant_id, branch_id, owner_type_code, name, status) VALUES ($1,$2,'branch','Main','active') RETURNING id",
      [tenantId, branchId],
    );
    await q(
      "INSERT INTO branch_accounting_assignments (tenant_id, branch_id, accounting_owner_id, effective_from, reason) VALUES ($1,$2,$3,'2020-01-01','wp-b test')",
      [tenantId, branchId, owner.id],
    );
    const [cal] = await q<{ id: string }>(
      'INSERT INTO fiscal_calendars (tenant_id, start_month, start_day, effective_from) VALUES ($1,$2,1,make_date($3,$2,1)) RETURNING id',
      [tenantId, startMonth, year],
    );
    await q('SELECT fn_generate_fiscal_year($1,$2,$3,$4)', [
      tenantId,
      cal.id,
      year,
      String(year),
    ]);
    await q(
      `INSERT INTO accounts (tenant_id, code, name, account_type, normal_balance, is_posting_account, is_system_account, is_active) VALUES
       ($1,'1000','Cash','asset','debit',true,true,true),($1,'1010','Bank','asset','debit',true,true,true),
       ($1,'1100','Accounts Receivable','asset','debit',true,true,true),($1,'1200','Inventory Asset','asset','debit',true,true,true),
       ($1,'2100','Accounts Payable','liability','credit',true,true,true),($1,'2200','Tax Payable','liability','credit',true,true,true),
       ($1,'4000','Sales Revenue','revenue','credit',true,true,true),($1,'5000','Cost of Goods Sold','expense','debit',true,true,true)`,
      [tenantId],
    );
    await q(
      `INSERT INTO account_role_assignments (tenant_id, role_code, account_id)
       SELECT $1, v.role_code, a.id FROM (VALUES ('default_cash','1000'),('default_bank','1010'),('accounts_receivable','1100'),
       ('inventory_asset','1200'),('accounts_payable','2100'),('tax_payable','2200'),('sales_revenue','4000'),('cogs','5000')) AS v(role_code, code)
       JOIN accounts a ON a.tenant_id = $1 AND a.code = v.code`,
      [tenantId],
    );
    return { tenantId, branchId, calendarId: cal.id };
  }

  /** The sale transaction as the pooled path runs it: insert order + post, one BEGIN/COMMIT. */
  async function sale(
    f: Fixture,
    createdAtIso: string,
  ): Promise<{
    ok: boolean;
    orderId: string;
    error?: string;
    entryId?: string;
  }> {
    const orderId = randomUUID();
    return withClient(async (c) => {
      try {
        await c.query('BEGIN');
        await c.query(
          "INSERT INTO orders (id, tenant_id, branch_id, status, subtotal, discount, tax, total, payment_method, held, sale_attempt_id, created_at) VALUES ($1,$2,$3,'completed',100,0,0,100,'cash',false,$4,$5)",
          [orderId, f.tenantId, f.branchId, randomUUID(), createdAtIso],
        );
        const r = await c.query(
          'SELECT fn_post_sales_order($1,$2,NULL,NULL) AS id',
          [f.tenantId, orderId],
        );
        await c.query('COMMIT');
        return { ok: true, orderId, entryId: r.rows[0].id };
      } catch (e: any) {
        await c.query('ROLLBACK').catch(() => undefined);
        return { ok: false, orderId, error: e.message as string };
      }
    });
  }

  const years = (t: string) =>
    q<{
      year_label: string;
      start_date: string;
      end_date: string;
      status: string;
    }>(
      "SELECT year_label, to_char(start_date,'YYYY-MM-DD') AS start_date, to_char(end_date,'YYYY-MM-DD') AS end_date, status FROM fiscal_years WHERE tenant_id=$1 ORDER BY start_date",
      [t],
    );
  const periodCount = async (t: string) =>
    (
      await q(
        'SELECT count(*)::int AS n FROM fiscal_periods WHERE tenant_id=$1',
        [t],
      )
    )[0].n as number;
  const orderExists = async (id: string) =>
    (await q('SELECT 1 FROM orders WHERE id=$1', [id])).length === 1;
  const entryDate = async (orderId: string) =>
    (
      await q(
        "SELECT to_char(posting_date,'YYYY-MM-DD') AS d FROM journal_entries WHERE source_module='sales' AND source_entity_id=$1 AND reversal_of_id IS NULL",
        [orderId],
      )
    )[0]?.d as string | undefined;

  beforeAll(async () => {
    const host = new URL(process.env.DATABASE_URL ?? 'postgres://invalid')
      .hostname;
    if (!LOOPBACK.includes(host))
      throw new Error(
        `WP-B suite refuses to run: DATABASE_URL host "${host}" is not loopback`,
      );
    pg = new PgClient({ connectionString: url() });
    await pg.connect();
    for (const fn of [
      'fn_ensure_fiscal_years',
      'fn_try_extend_fiscal_year',
      'fn_plan_fiscal_years',
    ]) {
      if (
        (await q('SELECT 1 FROM pg_proc WHERE proname=$1', [fn])).length === 0
      )
        throw new Error(`migration 325 is not applied locally (${fn} missing)`);
    }
    const eng = (
      await q(
        "SELECT pg_get_functiondef(p.oid) AS d FROM pg_proc p WHERE proname='fn_post_journal_entry'",
      )
    )[0].d as string;
    if (!/fn_try_extend_fiscal_year/.test(eng))
      throw new Error('migration 326 is not applied locally');
    // the ORIGINAL migration-182 engine, used to document "before the safety net" behaviour inside a rolled-back transaction
    const src = fs
      .readFileSync(
        path.resolve(
          __dirname,
          '..',
          '182_journal_entries_and_posting_engine.sql',
        ),
        'utf8',
      )
      .replace(/\r\n/g, '\n');
    const start = src.indexOf(
      'CREATE OR REPLACE FUNCTION fn_post_journal_entry(',
    );
    originalEngineSql = src.slice(
      start,
      src.indexOf('$$ LANGUAGE plpgsql;', start) +
        '$$ LANGUAGE plpgsql;'.length,
    );
  }, 60000);

  afterAll(async () => {
    await pg?.end();
  });

  // ===================================================================== generation
  describe('generation: idempotent, append-only, conservative', () => {
    it('dry-run is the default and writes nothing', async () => {
      const f = await makeTenant({ label: 'dry' });
      const before = {
        y: await years(f.tenantId),
        p: await periodCount(f.tenantId),
      };
      const rows = await q(
        "SELECT * FROM fn_ensure_fiscal_years($1,'2028-12-31')",
        [f.tenantId],
      );
      expect(rows.map((r) => [r.action, r.year_label, r.created])).toEqual([
        ['create', '2027', false],
        ['create', '2028', false],
      ]);
      expect({
        y: await years(f.tenantId),
        p: await periodCount(f.tenantId),
      }).toEqual(before);
      // the explicit plan function agrees and is read-only too
      const plan = await q(
        "SELECT action, year_label FROM fn_plan_fiscal_years($1,'2028-12-31')",
        [f.tenantId],
      );
      expect(plan.map((r) => r.year_label)).toEqual(['2027', '2028']);
    });

    it('2026 → 2027 (→ 2028): creates contiguous years with 12 open monthly periods each, labels as the bootstrap convention', async () => {
      const f = await makeTenant({ label: 'gen' });
      const rows = await q(
        "SELECT * FROM fn_ensure_fiscal_years($1,'2028-12-31',false)",
        [f.tenantId],
      );
      expect(rows.map((r) => [r.year_label, r.created])).toEqual([
        ['2027', true],
        ['2028', true],
      ]);
      expect(
        (await years(f.tenantId)).map((y) => [
          y.year_label,
          y.start_date,
          y.end_date,
          y.status,
        ]),
      ).toEqual([
        ['2026', '2026-01-01', '2027-01-01', 'open'],
        ['2027', '2027-01-01', '2028-01-01', 'open'],
        ['2028', '2028-01-01', '2029-01-01', 'open'],
      ]);
      expect(await periodCount(f.tenantId)).toBe(36);
      const gaps = await q(
        `SELECT p.end_date FROM fiscal_periods p WHERE p.tenant_id=$1 AND p.end_date < '2029-01-01'
         AND NOT EXISTS (SELECT 1 FROM fiscal_periods n WHERE n.tenant_id=p.tenant_id AND n.start_date=p.end_date)`,
        [f.tenantId],
      );
      expect(gaps.length).toBe(0);
    });

    it('is idempotent: repeating the call creates nothing and never duplicates a year', async () => {
      const f = await makeTenant({ label: 'idem' });
      await q("SELECT * FROM fn_ensure_fiscal_years($1,'2028-12-31',false)", [
        f.tenantId,
      ]);
      const rows = await q(
        "SELECT * FROM fn_ensure_fiscal_years($1,'2028-12-31',false)",
        [f.tenantId],
      );
      expect(rows.every((r) => r.created === false)).toBe(true);
      expect(rows[0].action).toBe('covered');
      expect((await years(f.tenantId)).length).toBe(3);
      expect(await periodCount(f.tenantId)).toBe(36);
    });

    it('never updates or deletes existing rows (ids and statuses unchanged) and cannot reopen a closed period', async () => {
      const f = await makeTenant({ label: 'immut' });
      await q(
        "UPDATE fiscal_periods SET status='closed' WHERE tenant_id=$1 AND period_number=12",
        [f.tenantId],
      );
      const snap = await q(
        'SELECT id, status, start_date, end_date FROM fiscal_periods WHERE tenant_id=$1 ORDER BY start_date',
        [f.tenantId],
      );
      await q("SELECT * FROM fn_ensure_fiscal_years($1,'2028-12-31',false)", [
        f.tenantId,
      ]);
      const after = await q(
        'SELECT id, status, start_date, end_date FROM fiscal_periods WHERE id = ANY($1) ORDER BY start_date',
        [snap.map((s) => s.id)],
      );
      expect(after).toEqual(snap);
      expect(after.filter((p) => p.status === 'closed').length).toBe(1);
      // new periods are open
      const newOpen = await q(
        "SELECT count(*)::int AS n FROM fiscal_periods WHERE tenant_id=$1 AND start_date >= '2027-01-01' AND status='open'",
        [f.tenantId],
      );
      expect(newOpen[0].n).toBe(24);
      // and the append-only guard is still there for anyone trying to remove a generated year
      await expect(
        pg.query('DELETE FROM fiscal_years WHERE tenant_id=$1', [f.tenantId]),
      ).rejects.toThrow(/append-only/);
    });

    it('refuses unsafe requests without creating anything', async () => {
      const f = await makeTenant({ label: 'refuse' });
      const far = await q(
        "SELECT action, detail FROM fn_plan_fiscal_years($1,'2040-01-01')",
        [f.tenantId],
      );
      expect(far[0].action).toBe('refuse');
      await expect(
        pg.query(
          "SELECT * FROM fn_ensure_fiscal_years($1,'2040-01-01',false)",
          [f.tenantId],
        ),
      ).rejects.toThrow(/refused/);
      const nul = await q('SELECT action FROM fn_plan_fiscal_years($1,NULL)', [
        f.tenantId,
      ]);
      expect(nul[0].action).toBe('refuse');
      expect((await years(f.tenantId)).length).toBe(1);

      const t = randomUUID();
      await q(
        "INSERT INTO tenants (id, name, business_type, status) VALUES ($1,$2,'retail','active')",
        [t, `${RUN}-nocal`],
      );
      expect(
        (
          await q(
            "SELECT action, detail FROM fn_plan_fiscal_years($1,'2027-12-31')",
            [t],
          )
        )[0].detail,
      ).toMatch(/no current fiscal calendar/);
    });

    it('detects a gap in existing years instead of building on top of it', async () => {
      const f = await makeTenant({ label: 'gap' });
      // a year starting 2027-03-01 leaves 2027-01-01..2027-03-01 uncovered
      await q(
        "INSERT INTO fiscal_years (tenant_id, fiscal_calendar_id, year_label, start_date, end_date) VALUES ($1,$2,'X-2027','2027-03-01','2028-03-01')",
        [f.tenantId, f.calendarId],
      );
      const plan = await q(
        "SELECT action, detail FROM fn_plan_fiscal_years($1,'2029-01-01')",
        [f.tenantId],
      );
      expect(plan[0].action).toBe('refuse');
      expect(plan[0].detail).toMatch(/not contiguous/);
    });

    it('a calendar version change that no longer lines up is refused (no overlap with existing periods is ever created)', async () => {
      const f = await makeTenant({ label: 'calchg' });
      await q(
        "UPDATE fiscal_calendars SET effective_to='2027-01-01' WHERE id=$1",
        [f.calendarId],
      );
      await q(
        "INSERT INTO fiscal_calendars (tenant_id, start_month, start_day, effective_from) VALUES ($1,7,1,'2027-01-01')",
        [f.tenantId],
      );
      const plan = await q(
        "SELECT action, detail FROM fn_plan_fiscal_years($1,'2028-12-31')",
        [f.tenantId],
      );
      expect(plan[0].action).toBe('refuse');
      expect(plan[0].detail).toMatch(/does not align/);
      await expect(
        pg.query(
          "SELECT * FROM fn_ensure_fiscal_years($1,'2028-12-31',false)",
          [f.tenantId],
        ),
      ).rejects.toThrow(/refused/);
      expect((await years(f.tenantId)).length).toBe(1);
    });

    it('non-January fiscal calendars continue from the previous end (April–March)', async () => {
      const f = await makeTenant({ label: 'apr', startMonth: 4 });
      const rows = await q(
        "SELECT * FROM fn_ensure_fiscal_years($1,'2028-03-31',false)",
        [f.tenantId],
      );
      expect(
        rows.map((r) => [
          r.year_label,
          r.start_date instanceof Date
            ? r.start_date.toISOString().slice(0, 10)
            : r.start_date,
        ]),
      ).toHaveLength(1);
      expect(
        (await years(f.tenantId)).map((y) => [y.start_date, y.end_date]),
      ).toEqual([
        ['2026-04-01', '2027-04-01'],
        ['2027-04-01', '2028-04-01'],
      ]);
    });

    it('PARALLEL calls (8 connections) create each year exactly once and none fails', async () => {
      const f = await makeTenant({ label: 'par' });
      const results = await Promise.allSettled(
        Array.from({ length: 8 }, () =>
          withClient((c) =>
            c.query(
              "SELECT * FROM fn_ensure_fiscal_years($1,'2028-12-31',false)",
              [f.tenantId],
            ),
          ),
        ),
      );
      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
      const created = results
        .flatMap((r) => (r as PromiseFulfilledResult<any>).value.rows)
        .filter((r: any) => r.created);
      expect(created.length).toBe(2); // exactly 2027 and 2028, by exactly one caller each
      expect((await years(f.tenantId)).length).toBe(3);
      expect(await periodCount(f.tenantId)).toBe(36);
    });

    it('coverage alerts: below the threshold → listed with a severity; after generation → gone', async () => {
      const f = await makeTenant({ label: 'alert' });
      const before = await q(
        'SELECT * FROM fn_fiscal_coverage_alerts(400) WHERE tenant_id=$1',
        [f.tenantId],
      );
      expect(before.length).toBe(1);
      expect(['expired', 'critical', 'high', 'warning']).toContain(
        before[0].severity,
      );
      expect(before[0].days_remaining).toBeLessThan(400);
      await q("SELECT * FROM fn_ensure_fiscal_years($1,'2028-12-31',false)", [
        f.tenantId,
      ]);
      expect(
        (
          await q(
            'SELECT * FROM fn_fiscal_coverage_alerts(180) WHERE tenant_id=$1',
            [f.tenantId],
          )
        ).length,
      ).toBe(0);
    });

    it('the helper functions are not reachable by anon/authenticated (service_role only)', async () => {
      const rows = await q(
        `SELECT has_function_privilege('anon','fn_ensure_fiscal_years(uuid,date,boolean)','EXECUTE') AS a,
                has_function_privilege('authenticated','fn_try_extend_fiscal_year(uuid,date)','EXECUTE') AS b,
                has_function_privilege('service_role','fn_ensure_fiscal_years(uuid,date,boolean)','EXECUTE') AS c,
                has_table_privilege('anon','v_fiscal_coverage','SELECT') AS d`,
      );
      expect(rows[0]).toEqual({ a: false, b: false, c: true, d: false });
    });
  });

  // ===================================================================== time zones
  describe('time zones and the accounting date', () => {
    it('fn_tenant_posting_date converts to the tenant zone and FAILS CLOSED (no silent UTC) on an invalid zone', async () => {
      const riyadh = await makeTenant({ label: 'tz1', tz: 'Asia/Riyadh' });
      const la = await makeTenant({ label: 'tz2', tz: 'America/Los_Angeles' });
      const bad = await makeTenant({ label: 'tz3', tz: 'Asia/Riyadh' });
      // simulate a legacy bad row (migration 327's write-guard would reject it on a normal UPDATE)
      await q("SET session_replication_role = 'replica'");
      await q("UPDATE tenants SET timezone='Not/AZone' WHERE id=$1", [
        bad.tenantId,
      ]);
      await q("SET session_replication_role = 'origin'");
      const d = async (t: string, ts: string) =>
        (
          await q(
            "SELECT to_char(fn_tenant_posting_date($1,$2::timestamptz),'YYYY-MM-DD') AS d",
            [t, ts],
          )
        )[0].d;
      expect(await d(riyadh.tenantId, '2026-12-31T21:00:00Z')).toBe(
        '2027-01-01',
      );
      expect(await d(riyadh.tenantId, '2026-12-31T20:59:59Z')).toBe(
        '2026-12-31',
      );
      expect(await d(la.tenantId, '2027-01-01T07:59:59Z')).toBe('2026-12-31');
      expect(await d(la.tenantId, '2027-01-01T08:00:00Z')).toBe('2027-01-01');
      await expect(d(bad.tenantId, '2026-12-31T23:59:59Z')).rejects.toThrow(
        /invalid_tenant_timezone/,
      );
    });
  });

  // ===================================================================== sale integrity
  describe('sale integrity at the 31 Dec 2026 / 1 Jan 2027 boundary (pooled-path transaction semantics)', () => {
    it('BEFORE the safety net (original engine, rolled back afterwards): a sale dated 2027-01-01 is rejected AND leaves nothing behind', async () => {
      const f = await makeTenant({ label: 'before' });
      const orderId = randomUUID();
      const out = await withClient(async (c) => {
        await c.query('BEGIN');
        try {
          await c.query(originalEngineSql); // CREATE OR REPLACE with the migration-182 body (transactional DDL)
          await c.query(
            "INSERT INTO orders (id, tenant_id, branch_id, status, subtotal, discount, tax, total, payment_method, held, sale_attempt_id, created_at) VALUES ($1,$2,$3,'completed',100,0,0,100,'cash',false,$4,'2027-01-01T10:00:00Z')",
            [orderId, f.tenantId, f.branchId, randomUUID()],
          );
          await c.query('SELECT fn_post_sales_order($1,$2,NULL,NULL)', [
            f.tenantId,
            orderId,
          ]);
          return 'posted';
        } catch (e: any) {
          return e.message as string;
        } finally {
          await c.query('ROLLBACK').catch(() => undefined);
        }
      });
      expect(out).toMatch(ENGINE_ERROR);
      expect(await orderExists(orderId)).toBe(false); // the sale is not saved without its entry
      // the engine in the database is the new one again (the DDL was rolled back too)
      const def = (
        await q(
          "SELECT pg_get_functiondef(p.oid) AS d FROM pg_proc p WHERE proname='fn_post_journal_entry'",
        )
      )[0].d as string;
      expect(def).toMatch(/fn_try_extend_fiscal_year/);
    });

    it('WITH the safety net: the first sale of 2027 succeeds, creates exactly one contiguous year, and is posted into January 2027', async () => {
      const f = await makeTenant({ label: 'net' });
      const r = await sale(f, '2027-01-01T10:00:00Z');
      expect(r.ok).toBe(true);
      expect(await orderExists(r.orderId)).toBe(true);
      expect(await entryDate(r.orderId)).toBe('2027-01-01');
      expect((await years(f.tenantId)).map((y) => y.year_label)).toEqual([
        '2026',
        '2027',
      ]);
      expect(await periodCount(f.tenantId)).toBe(24);
      const [je] = await q(
        'SELECT status, fiscal_period_id FROM journal_entries WHERE source_entity_id=$1 AND reversal_of_id IS NULL',
        [r.orderId],
      );
      expect(je.status).toBe('posted');
      const [p] = await q(
        "SELECT to_char(start_date,'YYYY-MM-DD') AS s FROM fiscal_periods WHERE id=$1",
        [je.fiscal_period_id],
      );
      expect(p.s).toBe('2027-01-01');
    });

    it('the boundary instants: 23:59:59Z on 31 Dec stays in 2026, 00:00:00Z on 1 Jan goes to 2027 (UTC session rule of the sale function)', async () => {
      const f = await makeTenant({ label: 'bound', tz: 'UTC' });
      const a = await sale(f, '2026-12-31T23:59:59Z');
      const b = await sale(f, '2027-01-01T00:00:00Z');
      expect(a.ok && b.ok).toBe(true);
      expect(await entryDate(a.orderId)).toBe('2026-12-31');
      expect(await entryDate(b.orderId)).toBe('2027-01-01');
    });

    it('DOCUMENTED EXCEPTION (P1-D6): for a Riyadh tenant the sale function uses the DB-session date, not the tenant date', async () => {
      const f = await makeTenant({ label: 'tzdoc', tz: 'Asia/Riyadh' });
      const at = '2026-12-31T21:30:00Z'; // 2027-01-01 00:30 in Riyadh
      const r = await sale(f, at);
      expect(r.ok).toBe(true);
      const [sess] = await q('SHOW TimeZone');
      const expectedSession = (
        await q(
          "SELECT to_char(($1::timestamptz AT TIME ZONE current_setting('TimeZone'))::date,'YYYY-MM-DD') AS d",
          [at],
        )
      )[0].d;
      expect(await entryDate(r.orderId)).toBe(expectedSession); // session-tz date (UTC in the docker DB)
      const tenantLocal = (
        await q(
          "SELECT to_char(fn_tenant_posting_date($1,$2::timestamptz),'YYYY-MM-DD') AS d",
          [f.tenantId, at],
        )
      )[0].d;
      expect(tenantLocal).toBe('2027-01-01');
      if (sess.TimeZone === 'UTC' || sess.TimeZone === 'Etc/UTC')
        expect(await entryDate(r.orderId)).not.toBe(tenantLocal);
    });

    it('cancelling a 2026 sale on 2027-01-01 (reversal date = new Date() of the app) works with the safety net and fails without it', async () => {
      const f = await makeTenant({ label: 'cancel' });
      const s = await sale(f, '2026-12-30T10:00:00Z');
      expect(s.ok).toBe(true);
      // without the net (original engine, rolled back)
      const without = await withClient(async (c) => {
        await c.query('BEGIN');
        try {
          await c.query(originalEngineSql);
          await c.query(
            "SELECT fn_reverse_sales_order($1,$2,NULL,'2027-01-01','Order cancelled')",
            [f.tenantId, s.orderId],
          );
          return 'reversed';
        } catch (e: any) {
          return e.message as string;
        } finally {
          await c.query('ROLLBACK').catch(() => undefined);
        }
      });
      expect(without).toMatch(ENGINE_ERROR);
      // with the net
      const rev = await q(
        "SELECT fn_reverse_sales_order($1,$2,NULL,'2027-01-01','Order cancelled') AS id",
        [f.tenantId, s.orderId],
      );
      expect(rev[0].id).toBeTruthy();
      expect((await years(f.tenantId)).map((y) => y.year_label)).toEqual([
        '2026',
        '2027',
      ]);
    });

    it('PARALLEL first sales of the new year (6 connections): all succeed, exactly one year is created, no duplicate entry', async () => {
      const f = await makeTenant({ label: 'parsale' });
      const res = await Promise.all(
        Array.from({ length: 6 }, () => sale(f, '2027-01-02T10:00:00Z')),
      );
      expect(res.every((r) => r.ok)).toBe(true);
      expect((await years(f.tenantId)).map((y) => y.year_label)).toEqual([
        '2026',
        '2027',
      ]);
      expect(await periodCount(f.tenantId)).toBe(24);
      const entries = await q(
        'SELECT count(*)::int AS n FROM journal_entries WHERE tenant_id=$1 AND reversal_of_id IS NULL',
        [f.tenantId],
      );
      expect(entries[0].n).toBe(6);
    });

    it('FAILURE (a): a date two years ahead is NOT silently created — the sale is rejected and rolled back, no year appears', async () => {
      const f = await makeTenant({ label: 'far' });
      const r = await sale(f, '2028-06-01T10:00:00Z');
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(ENGINE_ERROR);
      expect(await orderExists(r.orderId)).toBe(false);
      expect((await years(f.tenantId)).length).toBe(1);
    });

    it('FAILURE (b): a date before the first fiscal year is rejected and rolled back', async () => {
      const f = await makeTenant({ label: 'past' });
      const r = await sale(f, '2025-06-01T10:00:00Z');
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(ENGINE_ERROR);
      expect(await orderExists(r.orderId)).toBe(false);
      expect((await years(f.tenantId)).length).toBe(1);
    });

    it('FAILURE (c): a far-future date (beyond today + 1 year) is rejected even though it is adjacent', async () => {
      const f = await makeTenant({ label: 'future' });
      const r = await sale(f, '2027-12-30T10:00:00Z');
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(ENGINE_ERROR);
      expect(await orderExists(r.orderId)).toBe(false);
    });

    it('FAILURE (d): a gap or misaligned calendar makes year creation impossible → standard error, sale rolled back, nothing created', async () => {
      const gap = await makeTenant({ label: 'fgap' });
      await q(
        "INSERT INTO fiscal_years (tenant_id, fiscal_calendar_id, year_label, start_date, end_date) VALUES ($1,$2,'X-2027','2027-03-01','2028-03-01')",
        [gap.tenantId, gap.calendarId],
      );
      const r1 = await sale(gap, '2027-01-15T10:00:00Z');
      expect(r1.ok).toBe(false);
      expect(r1.error).toMatch(ENGINE_ERROR);
      expect(await orderExists(r1.orderId)).toBe(false);
      expect((await years(gap.tenantId)).length).toBe(2);

      const mis = await makeTenant({ label: 'fmis' });
      await q(
        "UPDATE fiscal_calendars SET effective_to='2027-01-01' WHERE id=$1",
        [mis.calendarId],
      );
      await q(
        "INSERT INTO fiscal_calendars (tenant_id, start_month, start_day, effective_from) VALUES ($1,7,1,'2027-01-01')",
        [mis.tenantId],
      );
      const r2 = await sale(mis, '2027-01-15T10:00:00Z');
      expect(r2.ok).toBe(false);
      expect(r2.error).toMatch(ENGINE_ERROR);
      expect(await orderExists(r2.orderId)).toBe(false);
      expect((await years(mis.tenantId)).length).toBe(1);
    });

    it('FAILURE (e): if generation itself fails mid-way, the nested sub-transaction leaves no partial year and the sale gets the standard error', async () => {
      const f = await makeTenant({ label: 'fgen' });
      // make fn_generate_fiscal_year fail for this tenant: a pre-existing LABEL collision with a non-matching range is refused by the plan,
      // so instead force a real failure inside generation with a table-level guard that raises on period insert for 2027 only.
      await q(`CREATE OR REPLACE FUNCTION fn_test_block_2027_periods() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
                 IF NEW.start_date = DATE '2027-06-01' AND NEW.tenant_id = '${f.tenantId}' THEN RAISE EXCEPTION 'simulated period insert failure'; END IF; RETURN NEW; END; $$`);
      await q(
        'CREATE TRIGGER trg_test_block_2027 BEFORE INSERT ON fiscal_periods FOR EACH ROW EXECUTE FUNCTION fn_test_block_2027_periods()',
      );
      try {
        const r = await sale(f, '2027-01-10T10:00:00Z');
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(ENGINE_ERROR);
        expect(await orderExists(r.orderId)).toBe(false);
        expect((await years(f.tenantId)).length).toBe(1); // the half-built 2027 year was rolled back
        expect(await periodCount(f.tenantId)).toBe(12);
      } finally {
        await q('DROP TRIGGER IF EXISTS trg_test_block_2027 ON fiscal_periods');
        await q('DROP FUNCTION IF EXISTS fn_test_block_2027_periods()');
      }
    });

    it('a CLOSED period still rejects postings (the net never reopens or bypasses status), while the new year stays open', async () => {
      const f = await makeTenant({ label: 'closed' });
      await q("SELECT * FROM fn_ensure_fiscal_years($1,'2027-12-31',false)", [
        f.tenantId,
      ]);
      await q(
        "UPDATE fiscal_periods SET status='closed' WHERE tenant_id=$1 AND start_date='2026-12-01'",
        [f.tenantId],
      );
      const rejected = await sale(f, '2026-12-15T10:00:00Z');
      expect(rejected.ok).toBe(false);
      expect(rejected.error).toMatch(/not open/);
      expect(await orderExists(rejected.orderId)).toBe(false);
      const ok = await sale(f, '2027-01-05T10:00:00Z');
      expect(ok.ok).toBe(true);
      expect(
        (
          await q(
            "SELECT status FROM fiscal_periods WHERE tenant_id=$1 AND start_date='2026-12-01'",
            [f.tenantId],
          )
        )[0].status,
      ).toBe('closed');
    });

    it('a covered date never triggers any generation (normal sales are unaffected)', async () => {
      const f = await makeTenant({ label: 'normal' });
      const r = await sale(f, '2026-06-15T10:00:00Z');
      expect(r.ok).toBe(true);
      expect((await years(f.tenantId)).length).toBe(1);
    });
  });
});
