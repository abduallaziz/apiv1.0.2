/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any */
/**
 * End-to-end proof of the CANDIDATE wiring (migrations_pending/328_posting_date_policy_wiring_CANDIDATE.sql):
 * sale, cancel and return through the REAL database functions with NO date passed by the caller.
 *
 * LOCAL DISPOSABLE DATABASE ONLY (`npm run test:integration:local`, which runs specs one at a time).
 * Loopback-guarded. beforeAll applies 325/326/327 + the 328 candidate to the LOCAL database; afterAll restores the
 * previous function bodies from migrations_pending/rollback/328_..._ROLLBACK.sql and asserts they are identical
 * (md5 of prosrc, line endings normalised) to what was there before — so the rollback plan is exercised on every run.
 * Nothing here touches any production path, file in src/database/migrations, or remote system.
 *
 * Clock note: cancel/return use now() (the event moment). Postgres cannot be time-faked, so year-boundary cancel/return
 * cases are driven through the floor rule (original entry dated in the future/next year) and the pure-function tests in
 * posting-date-policy.regression.spec.ts; the real-now() behaviour is asserted against fn_tenant_posting_date(now()).
 */
import * as fs from 'fs';
import * as path from 'path';
import { Client as PgClient } from 'pg';
import { randomUUID } from 'crypto';

const LOOPBACK = ['127.0.0.1', 'localhost', '::1', '[::1]'];
const RUN = `pw-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const PENDING = path.resolve(__dirname, '..', '..', 'migrations_pending');
const FNS = [
  'fn_post_sales_order',
  'fn_reverse_sales_order',
  'fn_create_sales_return',
];
const CLOSED = /not open|closed|locked/i;

describe('CANDIDATE 328 wiring — sale / cancel / return end to end (local only)', () => {
  let pg: PgClient;
  let before: Record<string, string> = {};
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
  const hashes = async () =>
    Object.fromEntries(
      (
        await q(
          "SELECT proname, md5(replace(prosrc, chr(13), '')) h FROM pg_proc WHERE proname = ANY($1) AND pronamespace = 'public'::regnamespace",
          [FNS],
        )
      ).map((r) => [r.proname, r.h]),
    );

  beforeAll(async () => {
    const host = new URL(process.env.DATABASE_URL ?? 'postgres://invalid')
      .hostname;
    if (!LOOPBACK.includes(host)) {
      throw new Error('wiring suite refuses to run against a non-loopback DB');
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
    before = await hashes();
    await pg.query(
      fs.readFileSync(
        path.join(PENDING, '328_posting_date_policy_wiring_CANDIDATE.sql'),
        'utf8',
      ),
    );
  }, 60000);

  afterAll(async () => {
    if (!pg) return;
    await pg.query(
      fs.readFileSync(
        path.join(
          PENDING,
          'rollback',
          '328_posting_date_policy_wiring_ROLLBACK.sql',
        ),
        'utf8',
      ),
    );
    const after = await hashes();
    await pg.end();
    expect(after).toEqual(before); // rollback restores byte-identical function bodies
  });

  async function forceZone(tenantId: string, tz: string) {
    await q("SET session_replication_role = 'replica'");
    try {
      await q('UPDATE tenants SET timezone=$2 WHERE id=$1', [tenantId, tz]);
    } finally {
      await q("SET session_replication_role = 'origin'");
    }
  }

  async function tenant(label: string, tz = 'Asia/Riyadh') {
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
    const [owner] = await q(
      "INSERT INTO accounting_owners (tenant_id, branch_id, owner_type_code, name, status) VALUES ($1,$2,'branch','Main','active') RETURNING id",
      [tenantId, branchId],
    );
    await q(
      "INSERT INTO branch_accounting_assignments (tenant_id, branch_id, accounting_owner_id, effective_from, reason) VALUES ($1,$2,$3,'2020-01-01','wiring test')",
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
  type T = { tenantId: string; branchId: string };

  /** completed card order: 2 lines, subtotal 100 + tax 15 = 115 */
  async function insertOrder(c: PgClient, f: T, createdAtIso: string) {
    const orderId = randomUUID();
    await c.query(
      "INSERT INTO orders (id, tenant_id, branch_id, status, subtotal, discount, tax, total, payment_method, held, sale_attempt_id, created_at) VALUES ($1,$2,$3,'completed',100,0,15,115,'card',false,$4,$5)",
      [orderId, f.tenantId, f.branchId, randomUUID(), createdAtIso],
    );
    const items: string[] = [];
    for (const [name, qty, total] of [
      ['A', 1, 40],
      ['B', 3, 60],
    ] as const) {
      const id = randomUUID();
      items.push(id);
      await c.query(
        'INSERT INTO order_items (id, order_id, item_name, qty, price, total_price) VALUES ($1,$2,$3,$4,$5,$6)',
        [id, orderId, name, qty, total / qty, total],
      );
    }
    return { orderId, items };
  }

  /** sale as the pooled path runs it: one transaction; `explicitDate` simulates a back/forward-dated posting. */
  async function sale(
    f: T,
    createdAtIso: string,
    explicitDate: string | null = null,
  ) {
    return withClient(async (c) => {
      try {
        await c.query('BEGIN');
        const o = await insertOrder(c, f, createdAtIso);
        const r = await c.query(
          'SELECT fn_post_sales_order($1,$2,NULL,$3::date) AS id',
          [f.tenantId, o.orderId, explicitDate],
        );
        await c.query('COMMIT');
        return { ok: true, ...o, entryId: r.rows[0].id as string };
      } catch (e: any) {
        await c.query('ROLLBACK').catch(() => undefined);
        return {
          ok: false,
          error: e.message as string,
          orderId: '',
          items: [] as string[],
          entryId: '',
        };
      }
    });
  }

  async function cancel(f: T, orderId: string, explicitDate: string | null) {
    return withClient(async (c) => {
      try {
        await c.query('BEGIN');
        const r = await c.query(
          "SELECT fn_reverse_sales_order($1,$2,NULL,$3::date,'Order cancelled') AS id",
          [f.tenantId, orderId, explicitDate],
        );
        await c.query('COMMIT');
        return { ok: true, entryId: r.rows[0].id as string };
      } catch (e: any) {
        await c.query('ROLLBACK').catch(() => undefined);
        return { ok: false, error: e.message as string, entryId: '' };
      }
    });
  }

  async function doReturn(f: T, orderId: string, items: [string, number][]) {
    return withClient(async (c) => {
      try {
        await c.query('BEGIN');
        const r = await c.query(
          "SELECT fn_create_sales_return($1,$2,NULL,NULL,'customer return',$3::jsonb) AS r",
          [
            f.tenantId,
            orderId,
            JSON.stringify(
              items.map(([order_item_id, quantity]) => ({
                order_item_id,
                quantity,
              })),
            ),
          ],
        );
        await c.query('COMMIT');
        return { ok: true, res: r.rows[0].r };
      } catch (e: any) {
        await c.query('ROLLBACK').catch(() => undefined);
        return { ok: false, error: e.message as string, res: null };
      }
    });
  }

  const entry = async (id: string) =>
    (
      await q(
        "SELECT to_char(posting_date,'YYYY-MM-DD') pd, to_char(document_date,'YYYY-MM-DD') dd, reversal_of_id FROM journal_entries WHERE id=$1",
        [id],
      )
    )[0];
  const count = async (table: string, t: string) =>
    (await q(`SELECT count(*)::int n FROM ${table} WHERE tenant_id=$1`, [t]))[0]
      .n as number;
  const returnEntries = (t: string) =>
    q(
      "SELECT id, to_char(posting_date,'YYYY-MM-DD') pd FROM journal_entries WHERE tenant_id=$1 AND source_entity_type='sales_return'",
      [t],
    );
  const today = async (t: string) =>
    (
      await q(
        "SELECT to_char(fn_tenant_posting_date($1, now()),'YYYY-MM-DD') d",
        [t],
      )
    )[0].d as string;
  const closeMonth = (t: string, startDate: string) =>
    q(
      "UPDATE fiscal_periods SET status='closed' WHERE tenant_id=$1 AND start_date=$2",
      [t, startDate],
    );
  const balanced = async (entryId: string) => {
    const [r] = await q(
      'SELECT coalesce(sum(debit_amount),0)::numeric d, coalesce(sum(credit_amount),0)::numeric c, count(*)::int n FROM journal_lines WHERE journal_entry_id=$1',
      [entryId],
    );
    return Number(r.d) === Number(r.c) && r.n > 0;
  };

  // ------------------------------------------------------------------ SALE
  describe('sale (no date passed)', () => {
    it('00:30 Riyadh on 1 Jan posts on 2027-01-01 (year created by the safety net); 23:59:59 Riyadh on 31 Dec stays in 2026', async () => {
      const f = await tenant('sale-bound');
      const a = await sale(f, '2026-12-31T20:59:59Z');
      const b = await sale(f, '2026-12-31T21:30:00Z');
      expect(a.ok && b.ok).toBe(true);
      expect((await entry(a.entryId)).pd).toBe('2026-12-31');
      expect((await entry(b.entryId)).pd).toBe('2027-01-01');
      expect((await entry(b.entryId)).dd).toBe('2027-01-01');
      expect(
        (
          await q(
            'SELECT count(*)::int n FROM fiscal_years WHERE tenant_id=$1',
            [f.tenantId],
          )
        )[0].n,
      ).toBe(2);
    });

    it('invalid/blank zone => the whole sale transaction rolls back (no order, no items, no entry)', async () => {
      for (const bad of ['Not/AZone', '']) {
        const f = await tenant('sale-badtz');
        await forceZone(f.tenantId, bad);
        const s = await sale(f, '2026-06-10T10:00:00Z');
        expect(s.ok).toBe(false);
        expect(s.error).toMatch(/invalid_tenant_timezone/);
        expect(await count('orders', f.tenantId)).toBe(0);
        expect(await count('journal_entries', f.tenantId)).toBe(0);
      }
    });

    it('closed period for the sale date => sale rolled back, nothing saved', async () => {
      const f = await tenant('sale-closed');
      await closeMonth(f.tenantId, '2026-06-01');
      const s = await sale(f, '2026-06-10T10:00:00Z');
      expect(s.ok).toBe(false);
      expect(s.error).toMatch(CLOSED);
      expect(await count('orders', f.tenantId)).toBe(0);
      expect(await count('journal_entries', f.tenantId)).toBe(0);
    });

    it('re-posting the same order and 4 parallel attempts leave exactly one sale entry', async () => {
      const f = await tenant('sale-dup');
      const s = await sale(f, '2026-07-01T10:00:00Z');
      expect(s.ok).toBe(true);
      await Promise.all(
        Array.from({ length: 4 }, () =>
          withClient(async (c) => {
            try {
              await c.query('BEGIN');
              await c.query('SELECT fn_post_sales_order($1,$2,NULL,NULL)', [
                f.tenantId,
                s.orderId,
              ]);
              await c.query('COMMIT');
            } catch {
              await c.query('ROLLBACK').catch(() => undefined);
            }
          }),
        ),
      );
      expect(await count('journal_entries', f.tenantId)).toBe(1);
    });
  });

  // ------------------------------------------------------------------ CANCEL
  describe('cancel / reversal (NULL date => policy)', () => {
    it('posts on the tenant-local date of now() — not the app/UTC date — and keeps the original entry untouched', async () => {
      const f = await tenant('cancel-now');
      const s = await sale(f, '2026-07-01T10:00:00Z');
      const c = await cancel(f, s.orderId, null);
      expect(c.ok).toBe(true);
      const rev = await entry(c.entryId);
      expect(rev.pd).toBe(await today(f.tenantId));
      expect(rev.reversal_of_id).toBe(s.entryId);
      expect((await entry(s.entryId)).pd).toBe('2026-07-01');
      expect(await balanced(c.entryId)).toBe(true);
    });

    it('FLOOR: original dated after now (future/next year) => the reversal is dated at the original, floor applied, never earlier', async () => {
      const f = await tenant('cancel-floor');
      const s = await sale(f, '2026-07-01T10:00:00Z', '2027-01-05');
      expect(s.ok).toBe(true);
      expect((await entry(s.entryId)).pd).toBe('2027-01-05');
      const c = await cancel(f, s.orderId, null);
      expect(c.ok).toBe(true);
      expect((await entry(c.entryId)).pd).toBe('2027-01-05'); // = max(today, 2027-01-05)
    });

    it('closed period for the policy date => refused, atomic: no reversal entry, original stays unreversed', async () => {
      const f = await tenant('cancel-closed');
      const s = await sale(f, '2026-07-01T10:00:00Z');
      const t = await today(f.tenantId);
      await closeMonth(f.tenantId, `${t.slice(0, 7)}-01`);
      const c = await cancel(f, s.orderId, null);
      expect(c.ok).toBe(false);
      expect(c.error).toMatch(CLOSED);
      expect(await count('journal_entries', f.tenantId)).toBe(1);
      expect(
        (
          await q(
            'SELECT count(*)::int n FROM journal_entries WHERE tenant_id=$1 AND reversal_of_id IS NOT NULL',
            [f.tenantId],
          )
        )[0].n,
      ).toBe(0);
    });

    it('CORRECTION path (separate from automatic policy): an explicit date into an OPEN period works, into a CLOSED period is still refused', async () => {
      const f = await tenant('cancel-corr');
      const s = await sale(f, '2026-07-01T10:00:00Z');
      const t = await today(f.tenantId);
      await closeMonth(f.tenantId, `${t.slice(0, 7)}-01`);
      await closeMonth(f.tenantId, '2026-07-01');
      const refused = await cancel(f, s.orderId, '2026-07-15'); // closed month
      expect(refused.ok).toBe(false);
      expect(refused.error).toMatch(CLOSED);
      const okc = await cancel(f, s.orderId, '2026-12-02'); // open month, explicit authorised date
      expect(okc.ok).toBe(true);
      expect((await entry(okc.entryId)).pd).toBe('2026-12-02');
    });

    it('cancelling twice never creates a second reversal (no duplicate)', async () => {
      const f = await tenant('cancel-dup');
      const s = await sale(f, '2026-07-01T10:00:00Z');
      const [a, b] = await Promise.all([
        cancel(f, s.orderId, null),
        cancel(f, s.orderId, null),
      ]);
      expect([a.ok, b.ok].filter(Boolean).length).toBeLessThanOrEqual(2);
      expect(
        (
          await q(
            'SELECT count(*)::int n FROM journal_entries WHERE tenant_id=$1 AND reversal_of_id IS NOT NULL',
            [f.tenantId],
          )
        )[0].n,
      ).toBe(1);
    });
  });

  // ------------------------------------------------------------------ RETURN
  describe('sales return (policy inside fn_create_sales_return)', () => {
    it('partial return posts on the tenant-local date of now(), balanced, original untouched; refund shares are consistent', async () => {
      const f = await tenant('ret-basic');
      const s = await sale(f, '2026-07-01T10:00:00Z');
      const r = await doReturn(f, s.orderId, [[s.items[0], 1]]);
      expect(r.ok).toBe(true);
      expect(Number(r.res.refund_total)).toBeCloseTo(46, 2); // 40/100 of 100 net + 40% of 15 tax
      const es = await returnEntries(f.tenantId);
      expect(es).toHaveLength(1);
      expect(es[0].pd).toBe(await today(f.tenantId));
      expect(await balanced(es[0].id)).toBe(true);
      expect((await entry(s.entryId)).pd).toBe('2026-07-01');
    });

    it('FLOOR: return of a sale whose entry is dated 2027-01-05 posts on 2027-01-05 (2027 period exists once), never before the sale', async () => {
      const f = await tenant('ret-floor');
      const s = await sale(f, '2026-07-01T10:00:00Z', '2027-01-05');
      const r = await doReturn(f, s.orderId, [[s.items[1], 3]]);
      expect(r.ok).toBe(true);
      expect((await returnEntries(f.tenantId))[0].pd).toBe('2027-01-05');
      expect(
        (
          await q(
            'SELECT count(*)::int n FROM fiscal_years WHERE tenant_id=$1',
            [f.tenantId],
          )
        )[0].n,
      ).toBe(2);
    });

    it('invalid zone => the return is refused and NOTHING is written (no sales_returns row, no entry)', async () => {
      const f = await tenant('ret-badtz');
      const s = await sale(f, '2026-07-01T10:00:00Z');
      await forceZone(f.tenantId, 'Not/AZone');
      const r = await doReturn(f, s.orderId, [[s.items[0], 1]]);
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/invalid_tenant_timezone/);
      expect(await count('sales_returns', f.tenantId)).toBe(0);
      expect(await returnEntries(f.tenantId)).toHaveLength(0);
    });

    it('closed period for the return date => refused, atomic (no sales_returns row, no entry)', async () => {
      const f = await tenant('ret-closed');
      const s = await sale(f, '2026-07-01T10:00:00Z');
      const t = await today(f.tenantId);
      await closeMonth(f.tenantId, `${t.slice(0, 7)}-01`);
      const r = await doReturn(f, s.orderId, [[s.items[0], 1]]);
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(CLOSED);
      expect(await count('sales_returns', f.tenantId)).toBe(0);
      expect(await returnEntries(f.tenantId)).toHaveLength(0);
    });

    it('no over-return: returning more than sold is refused, and two PARALLEL full returns => exactly one succeeds', async () => {
      const f = await tenant('ret-dup');
      const s = await sale(f, '2026-07-01T10:00:00Z');
      const over = await doReturn(f, s.orderId, [[s.items[0], 2]]);
      expect(over.ok).toBe(false);
      expect(over.error).toMatch(/only 1 remaining|Cannot return/);
      const res = await Promise.all([
        doReturn(f, s.orderId, [
          [s.items[0], 1],
          [s.items[1], 3],
        ]),
        doReturn(f, s.orderId, [
          [s.items[0], 1],
          [s.items[1], 3],
        ]),
      ]);
      expect(res.filter((r) => r.ok)).toHaveLength(1);
      expect(await count('sales_returns', f.tenantId)).toBe(1);
      expect(await returnEntries(f.tenantId)).toHaveLength(1);
    });

    it('LEGACY compatibility: a return of an order that was never posted still works and creates no entry (unchanged behaviour)', async () => {
      const f = await tenant('ret-legacy');
      const o = await withClient(async (c) => {
        const x = await insertOrder(c, f, '2026-07-01T10:00:00Z');
        return x; // inserted, NEVER posted (what the non-pooled path leaves behind)
      });
      const r = await doReturn(f, o.orderId, [[o.items[0], 1]]);
      expect(r.ok).toBe(true);
      expect(await returnEntries(f.tenantId)).toHaveLength(0);
      expect(await count('journal_entries', f.tenantId)).toBe(0);
    });
  });

  // ------------------------------------------------------------------ cross-document consistency
  describe('one document chain, one rule', () => {
    it('sale, cancel and a return on the same local day use the same tenant-local date source', async () => {
      const f = await tenant('chain');
      const s1 = await sale(f, new Date().toISOString());
      const s2 = await sale(f, new Date().toISOString());
      const r = await doReturn(f, s1.orderId, [[s1.items[0], 1]]);
      const c = await cancel(f, s2.orderId, null);
      expect(r.ok && c.ok).toBe(true);
      const t = await today(f.tenantId);
      expect((await entry(s1.entryId)).pd).toBe(t);
      expect((await returnEntries(f.tenantId))[0].pd).toBe(t);
      expect((await entry(c.entryId)).pd).toBe(t);
    });
  });
});
