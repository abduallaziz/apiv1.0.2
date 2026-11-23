/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any */
/**
 * WP-B follow-up — proposed single posting-date policy (migration 327, pending, NOT wired into any path).
 * LOCAL DISPOSABLE DATABASE ONLY (`npm run test:integration:local`). Loopback-guarded.
 * Applies 325 + 326 + 327 itself (all idempotent CREATE OR REPLACE / DROP-CREATE trigger) to the local DB.
 *
 * "Wiring" is simulated by the TEST passing the policy date as the existing p_posting_date argument of
 * fn_post_sales_order / fn_reverse_sales_order — so nothing in the sale path is changed to prove the design.
 * (fn_create_sales_return computes its own date inside the function and would need a function change.)
 *
 * Disclosed leftovers: same as fiscal-year-continuity.regression.spec.ts (append-only data, local DB only).
 */
import * as fs from 'fs';
import * as path from 'path';
import { Client as PgClient } from 'pg';
import { randomUUID } from 'crypto';

const LOOPBACK = ['127.0.0.1', 'localhost', '::1', '[::1]'];
const RUN = `pd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const PENDING = path.resolve(__dirname, '..', '..', 'migrations_pending');
const ENGINE_ERROR = /No fiscal period covers posting date|not open/;

describe('posting-date policy (proposal) — tenant-local date, strict zone, one rule for sale/cancel/return', () => {
  let pg: PgClient;
  async function q<T = any>(sql: string, p: unknown[] = []): Promise<T[]> {
    return (await pg.query(sql, p)).rows as T[];
  }
  async function withClient<T>(fn: (c: PgClient) => Promise<T>): Promise<T> {
    const c = new PgClient({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    try {
      return await fn(c);
    } finally {
      await c.end();
    }
  }

  beforeAll(async () => {
    const host = new URL(process.env.DATABASE_URL ?? 'postgres://invalid')
      .hostname;
    if (!LOOPBACK.includes(host)) {
      throw new Error('policy suite refuses to run against a non-loopback DB');
    }
    pg = new PgClient({ connectionString: process.env.DATABASE_URL });
    await pg.connect();
    for (const f of [
      '325_fiscal_year_continuity.sql',
      '326_fiscal_period_safety_net.sql',
      '327_posting_date_policy.sql',
    ]) {
      await pg.query(fs.readFileSync(path.join(PENDING, f), 'utf8'));
    }
  }, 60000);
  afterAll(async () => {
    await pg?.end();
  });

  /** Legacy bad value, as it could exist today (the 327 write-guard rejects it on a normal write). */
  async function forceZone(tenantId: string, tz: string) {
    await q("SET session_replication_role = 'replica'");
    try {
      await q('UPDATE tenants SET timezone=$2 WHERE id=$1', [tenantId, tz]);
    } finally {
      await q("SET session_replication_role = 'origin'");
    }
  }

  /** Tenant with a complete accounting bootstrap (2026 year only; 326 extends on demand). */
  async function tenant(
    tz: string,
    label: string,
    withAccounting = true,
  ): Promise<{ tenantId: string; branchId: string }> {
    const tenantId = randomUUID();
    const branchId = randomUUID();
    await q(
      'INSERT INTO tenants (id, name, business_type, status, timezone) VALUES ($1,$2,$3,$4,$5)',
      [tenantId, `${RUN}-${label}`, 'retail', 'active', tz],
    );
    await q('INSERT INTO branches (id, tenant_id, name) VALUES ($1,$2,$3)', [
      branchId,
      tenantId,
      'Main',
    ]);
    if (!withAccounting) return { tenantId, branchId };
    const [owner] = await q(
      "INSERT INTO accounting_owners (tenant_id, branch_id, owner_type_code, name, status) VALUES ($1,$2,'branch','Main','active') RETURNING id",
      [tenantId, branchId],
    );
    await q(
      "INSERT INTO branch_accounting_assignments (tenant_id, branch_id, accounting_owner_id, effective_from, reason) VALUES ($1,$2,$3,'2020-01-01','policy test')",
      [tenantId, branchId, owner.id],
    );
    const [cal] = await q(
      'INSERT INTO fiscal_calendars (tenant_id, start_month, start_day, effective_from) VALUES ($1,1,1,make_date(2026,1,1)) RETURNING id',
      [tenantId],
    );
    await q('SELECT fn_generate_fiscal_year($1,$2,2026,$3)', [
      tenantId,
      cal.id,
      '2026',
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
    return { tenantId, branchId };
  }

  const dt = async (t: string, kind: string, at: string, orig?: string) =>
    (
      await q(
        "SELECT to_char(fn_posting_date_for_event($1,$2,$3::timestamptz,$4::date),'YYYY-MM-DD') AS d",
        [t, kind, at, orig ?? null],
      )
    )[0].d as string;

  /** Pooled-path sale transaction using the POLICY date as the existing p_posting_date argument. */
  async function saleWithPolicy(
    f: { tenantId: string; branchId: string },
    createdAtIso: string,
    existingOrderId?: string,
  ) {
    const orderId = existingOrderId ?? randomUUID();
    return withClient(async (c) => {
      try {
        await c.query('BEGIN');
        if (!existingOrderId) {
          await c.query(
            "INSERT INTO orders (id, tenant_id, branch_id, status, subtotal, discount, tax, total, payment_method, held, sale_attempt_id, created_at) VALUES ($1,$2,$3,'completed',100,0,0,100,'cash',false,$4,$5)",
            [orderId, f.tenantId, f.branchId, randomUUID(), createdAtIso],
          );
        }
        const r = await c.query(
          "SELECT fn_post_sales_order($1,$2,NULL, fn_posting_date_for_event($1,'sale',$3::timestamptz)) AS id",
          [f.tenantId, orderId, createdAtIso],
        );
        await c.query('COMMIT');
        return { ok: true, orderId, entryId: r.rows[0].id as string };
      } catch (e: any) {
        await c.query('ROLLBACK').catch(() => undefined);
        return { ok: false, orderId, error: e.message as string };
      }
    });
  }

  /** Cancel (reversal) using the policy date; floor = original entry's posting date. */
  async function cancelWithPolicy(
    f: { tenantId: string },
    orderId: string,
    eventIso: string,
    originalPostingDate: string,
  ) {
    return withClient(async (c) => {
      try {
        await c.query('BEGIN');
        const r = await c.query(
          "SELECT fn_reverse_sales_order($1,$2,NULL, fn_posting_date_for_event($1,'cancel',$3::timestamptz,$4::date),'Order cancelled') AS id",
          [f.tenantId, orderId, eventIso, originalPostingDate],
        );
        await c.query('COMMIT');
        return { ok: true, entryId: r.rows[0].id as string };
      } catch (e: any) {
        await c.query('ROLLBACK').catch(() => undefined);
        return { ok: false, error: e.message as string };
      }
    });
  }

  const entry = async (id: string) =>
    (
      await q(
        "SELECT to_char(posting_date,'YYYY-MM-DD') AS pd, reversal_of_id FROM journal_entries WHERE id=$1",
        [id],
      )
    )[0];
  const entriesFor = async (t: string) =>
    (
      await q(
        'SELECT count(*)::int n FROM journal_entries WHERE tenant_id=$1',
        [t],
      )
    )[0].n as number;
  const ordersFor = async (t: string) =>
    (await q('SELECT count(*)::int n FROM orders WHERE tenant_id=$1', [t]))[0]
      .n as number;

  // ================================================================ pure policy
  describe('policy function', () => {
    it('sale: Riyadh 21:00:00Z is the next local day (the date the cashier saw); 20:59:59Z is not', async () => {
      const { tenantId } = await tenant('Asia/Riyadh', 'sale', false);
      expect(await dt(tenantId, 'sale', '2026-12-31T21:30:00Z')).toBe(
        '2027-01-01',
      );
      expect(await dt(tenantId, 'sale', '2026-12-31T21:00:00Z')).toBe(
        '2027-01-01',
      );
      expect(await dt(tenantId, 'sale', '2026-12-31T20:59:59Z')).toBe(
        '2026-12-31',
      );
    });

    it('cancel and return use the SAME tenant-local rule as the sale', async () => {
      const { tenantId } = await tenant('Asia/Riyadh', 'same', false);
      const at = '2026-12-31T21:10:00Z';
      const s = await dt(tenantId, 'sale', at);
      expect(await dt(tenantId, 'cancel', at)).toBe(s);
      expect(await dt(tenantId, 'return', at)).toBe(s);
    });

    it('zones behind UTC (Los Angeles) and with DST are handled by the zone database', async () => {
      const { tenantId } = await tenant('America/Los_Angeles', 'la', false);
      expect(await dt(tenantId, 'sale', '2027-01-01T07:59:59Z')).toBe(
        '2026-12-31',
      );
      expect(await dt(tenantId, 'sale', '2027-01-01T08:00:00Z')).toBe(
        '2027-01-01',
      );
      // DST start in LA 2026-03-08: local midnight is 08:00Z before, 07:00Z after the switch
      expect(await dt(tenantId, 'sale', '2026-03-09T06:59:59Z')).toBe(
        '2026-03-08',
      );
      expect(await dt(tenantId, 'sale', '2026-03-09T07:00:00Z')).toBe(
        '2026-03-09',
      );
    });

    it('NO silent fallback: blank, unknown and abbreviation zones all raise invalid_tenant_timezone', async () => {
      for (const [i, bad] of ['', '   ', 'Not/AZone', 'EST'].entries()) {
        const { tenantId } = await tenant('Asia/Riyadh', `bad${i}`, false);
        await forceZone(tenantId, bad);
        await expect(
          dt(tenantId, 'sale', '2026-12-31T23:59:59Z'),
        ).rejects.toThrow(/invalid_tenant_timezone/);
      }
    });

    it('the floor: a reversal is never dated before the entry it reverses, and the floor is REPORTED (never silent)', async () => {
      const { tenantId } = await tenant('Asia/Riyadh', 'floor', false);
      const det = async (kind: string, at: string, orig: string) =>
        (
          await q(
            "SELECT to_char(posting_date,'YYYY-MM-DD') pd, to_char(event_local_date,'YYYY-MM-DD') ev, floored FROM fn_posting_date_detail($1,$2,$3::timestamptz,$4::date)",
            [tenantId, kind, at, orig],
          )
        )[0];
      // clock skew / back-dated import: event local date (12-29) is before the original posting date (12-30)
      expect(await det('cancel', '2026-12-29T10:00:00Z', '2026-12-30')).toEqual(
        {
          pd: '2026-12-30',
          ev: '2026-12-29',
          floored: true,
        },
      );
      // normal case: event after original => untouched, floored=false
      expect(await det('return', '2027-01-05T10:00:00Z', '2026-12-31')).toEqual(
        {
          pd: '2027-01-05',
          ev: '2027-01-05',
          floored: false,
        },
      );
      // a sale is never floored (no original)
      expect(
        (await det('sale', '2026-12-29T10:00:00Z', '2026-12-31')).floored,
      ).toBe(false);
    });

    it('rejects an unknown kind and a missing event time (never guesses a date)', async () => {
      const { tenantId } = await tenant('Asia/Riyadh', 'inv', false);
      await expect(
        q("SELECT fn_posting_date_for_event($1,'refund',now())", [tenantId]),
      ).rejects.toThrow(/unknown kind/);
      await expect(
        q("SELECT fn_posting_date_for_event($1,'sale',NULL)", [tenantId]),
      ).rejects.toThrow(/event time is required/);
    });

    it('the policy functions have no write path', async () => {
      const rows = await q(
        "SELECT prosrc FROM pg_proc WHERE proname IN ('fn_posting_date_for_event','fn_posting_date_detail','fn_tenant_posting_date','fn_is_valid_timezone')",
      );
      expect(rows.length).toBe(4);
      for (const r of rows)
        expect(r.prosrc).not.toMatch(
          /\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i,
        );
    });
  });

  // ================================================================ zone settings: guard + audit
  describe('time-zone setting is explicit, validated and audited (existing tenants)', () => {
    it('the write guard rejects an invalid zone on insert and on change, accepts valid IANA names', async () => {
      await expect(
        q(
          "INSERT INTO tenants (id,name,business_type,status,timezone) VALUES ($1,$2,'retail','active','Mars/Base')",
          [randomUUID(), `${RUN}-guard`],
        ),
      ).rejects.toThrow(/invalid_tenant_timezone/);
      const { tenantId } = await tenant('Asia/Riyadh', 'guard2', false);
      await expect(
        q("UPDATE tenants SET timezone='EST' WHERE id=$1", [tenantId]),
      ).rejects.toThrow(/invalid_tenant_timezone/);
      await q("UPDATE tenants SET timezone='Europe/London' WHERE id=$1", [
        tenantId,
      ]);
      expect(
        (await q('SELECT timezone FROM tenants WHERE id=$1', [tenantId]))[0]
          .timezone,
      ).toBe('Europe/London');
    });

    it('a legacy invalid row is NOT blocked from unrelated updates, and the audit lists it (read-only)', async () => {
      const bad = await tenant('Asia/Riyadh', 'legacy-bad', false);
      const blank = await tenant('Asia/Riyadh', 'legacy-blank', false);
      const good = await tenant('Asia/Riyadh', 'legacy-good', false);
      await forceZone(bad.tenantId, 'Not/AZone');
      await forceZone(blank.tenantId, '');
      await q("UPDATE tenants SET name=name || '!' WHERE id=$1", [
        bad.tenantId,
      ]); // unrelated write passes
      const snapshot = () =>
        q('SELECT id, timezone FROM tenants WHERE name LIKE $1 ORDER BY id', [
          `${RUN}-legacy%`,
        ]);
      const before = await snapshot();
      const audit = await q(
        'SELECT tenant_id, status FROM fn_tenant_timezone_audit() WHERE tenant_id = ANY($1)',
        [[bad.tenantId, blank.tenantId, good.tenantId]],
      );
      const by = Object.fromEntries(audit.map((r) => [r.tenant_id, r.status]));
      expect(by[bad.tenantId]).toBe('invalid');
      expect(by[blank.tenantId]).toBe('blank');
      expect(by[good.tenantId]).toBe('valid');
      expect(await snapshot()).toEqual(before); // the audit changed nothing
    });
  });

  // ================================================================ drift report
  describe('impact (drift) report', () => {
    it('lists only the orders whose date would change, and is read-only', async () => {
      const f = await tenant('Asia/Riyadh', 'drift', false);
      const ins = (iso: string) =>
        q(
          "INSERT INTO orders (id, tenant_id, branch_id, status, subtotal, discount, tax, total, payment_method, held, sale_attempt_id, created_at) VALUES ($1,$2,$3,'completed',10,0,0,10,'cash',false,$4,$5)",
          [randomUUID(), f.tenantId, f.branchId, randomUUID(), iso],
        );
      await ins('2026-12-31T21:30:00Z');
      await ins('2026-12-31T10:00:00Z');
      await ins('2026-06-10T22:30:00Z');
      const before = await ordersFor(f.tenantId);
      const rows = await q(
        "SELECT to_char(current_rule_date,'YYYY-MM-DD') cur, to_char(policy_date,'YYYY-MM-DD') pol FROM fn_posting_date_drift($1,'2026-01-01','2027-12-31')",
        [f.tenantId],
      );
      const [{ tz }] = await q("SELECT current_setting('TimeZone') AS tz");
      if (tz === 'UTC' || tz === 'Etc/UTC') {
        expect(rows.map((r) => `${r.cur}>${r.pol}`).sort()).toEqual([
          '2026-06-10>2026-06-11',
          '2026-12-31>2027-01-01',
        ]);
      }
      expect(await ordersFor(f.tenantId)).toBe(before);
    });
  });

  // ================================================================ with the REAL posting engine
  describe('real engine: year crossing, atomicity, no duplicates, closed periods (policy date passed by the caller)', () => {
    it('year crossing: 31 Dec 23:30 Riyadh sale -> 2026; cancelled 1 Jan 00:10 Riyadh -> 2027; original entry untouched; event UTC unchanged', async () => {
      const f = await tenant('Asia/Riyadh', 'cross');
      const s = await saleWithPolicy(f, '2026-12-31T20:30:00Z');
      expect(s.ok).toBe(true);
      expect((await entry(s.entryId as string)).pd).toBe('2026-12-31');
      const c = await cancelWithPolicy(
        f,
        s.orderId,
        '2026-12-31T21:10:00Z',
        '2026-12-31',
      );
      expect(c.ok).toBe(true);
      const rev = await entry(c.entryId as string);
      expect(rev.pd).toBe('2027-01-01'); // 326 created 2027 on demand
      expect(rev.reversal_of_id).toBe(s.entryId);
      expect((await entry(s.entryId as string)).pd).toBe('2026-12-31'); // posted entry never moved
      const [o] = await q(
        "SELECT to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI') AS u FROM orders WHERE id=$1",
        [s.orderId],
      );
      expect(o.u).toBe('2026-12-31T20:30'); // event time is not rewritten
    });

    it('boundary sale at 00:30 Riyadh on 1 Jan is posted on 2027-01-01 (the document date shown to the cashier)', async () => {
      const f = await tenant('Asia/Riyadh', 'bound');
      const s = await saleWithPolicy(f, '2026-12-31T21:30:00Z');
      expect(s.ok).toBe(true);
      expect((await entry(s.entryId as string)).pd).toBe('2027-01-01');
    });

    it('atomicity: invalid zone => the WHOLE sale transaction rolls back (no order, no entry), standard error', async () => {
      const f = await tenant('Asia/Riyadh', 'atomic');
      await forceZone(f.tenantId, 'Not/AZone');
      const s = await saleWithPolicy(f, '2026-06-10T10:00:00Z');
      expect(s.ok).toBe(false);
      expect(s.error).toMatch(/invalid_tenant_timezone/);
      expect(await ordersFor(f.tenantId)).toBe(0);
      expect(await entriesFor(f.tenantId)).toBe(0);
    });

    it('atomicity: policy date outside any creatable period (far future) => sale rolled back, nothing created', async () => {
      const f = await tenant('Asia/Riyadh', 'atomic2');
      const s = await saleWithPolicy(f, '2031-06-10T10:00:00Z');
      expect(s.ok).toBe(false);
      expect(s.error).toMatch(ENGINE_ERROR);
      expect(await ordersFor(f.tenantId)).toBe(0);
      expect(await entriesFor(f.tenantId)).toBe(0);
    });

    it('no duplicates: posting the same order twice, and 4 in parallel, yields exactly one sale entry', async () => {
      const f = await tenant('Asia/Riyadh', 'dup');
      const first = await saleWithPolicy(f, '2026-07-01T10:00:00Z');
      expect(first.ok).toBe(true);
      const again = await saleWithPolicy(
        f,
        '2026-07-01T10:00:00Z',
        first.orderId,
      );
      expect(again.ok === false || again.entryId === first.entryId).toBe(true);
      await Promise.all(
        Array.from({ length: 4 }, () =>
          saleWithPolicy(f, '2026-07-01T10:00:00Z', first.orderId),
        ),
      );
      expect(await entriesFor(f.tenantId)).toBe(1);
    });

    it('closed period: a cancel whose policy date falls in a closed period is REFUSED (no entry, never back-dated); after the close it posts in the open period', async () => {
      const f = await tenant('Asia/Riyadh', 'closed');
      const s = await saleWithPolicy(f, '2026-12-30T10:00:00Z');
      expect(s.ok).toBe(true);
      await q(
        "UPDATE fiscal_periods SET status='closed' WHERE tenant_id=$1 AND start_date='2026-12-01'",
        [f.tenantId],
      );
      const refused = await cancelWithPolicy(
        f,
        s.orderId,
        '2026-12-31T10:00:00Z',
        '2026-12-30',
      );
      expect(refused.ok).toBe(false);
      expect(refused.error).toMatch(/not open|closed|locked/i);
      expect(await entriesFor(f.tenantId)).toBe(1);
      const later = await cancelWithPolicy(
        f,
        s.orderId,
        '2027-01-02T10:00:00Z',
        '2026-12-30',
      );
      expect(later.ok).toBe(true);
      expect((await entry(later.entryId as string)).pd).toBe('2027-01-02');
      expect((await entry(s.entryId as string)).pd).toBe('2026-12-30'); // original stays in the closed period
      expect(
        (
          await q(
            "SELECT status FROM fiscal_periods WHERE tenant_id=$1 AND start_date='2026-12-01'",
            [f.tenantId],
          )
        )[0].status,
      ).toBe('closed'); // never reopened
    });

    it('the floor can never smuggle a posting into a closed period: floored date in a closed period is refused', async () => {
      const f = await tenant('Asia/Riyadh', 'floorclosed');
      const s = await saleWithPolicy(f, '2026-12-30T10:00:00Z');
      expect(s.ok).toBe(true);
      await q(
        "UPDATE fiscal_periods SET status='closed' WHERE tenant_id=$1 AND start_date='2026-12-01'",
        [f.tenantId],
      );
      // skewed event clock (12-29) -> floor lifts the date to 12-30 (closed) -> engine refuses
      const r = await cancelWithPolicy(
        f,
        s.orderId,
        '2026-12-29T10:00:00Z',
        '2026-12-30',
      );
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/not open|closed|locked/i);
      expect(await entriesFor(f.tenantId)).toBe(1);
    });
  });
});
