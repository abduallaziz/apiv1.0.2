/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any */
/**
 * T5 — historical-sales reconciliation mechanism (migration 330, pending). LOCAL DISPOSABLE DATABASE ONLY.
 * Applies 325 + 326 + 327 + 330 itself (idempotent) to the local DB and builds SYNTHETIC tenants (no real data).
 * Proves: dry run is read-only and repeatable; apply posts through the real engine with the tenant-local sale date;
 * a double run is a no-op; closed/missing periods and missing owner assignments are REFUSED (nothing reopened,
 * nothing created); a mixed batch isolates failures per order; concurrent applies cannot double post;
 * the audit is append-only; the rollback script removes the objects and keeps the evidence.
 */
import * as fs from 'fs';
import * as path from 'path';
import { Client as PgClient } from 'pg';
import { randomUUID } from 'crypto';

const LOOPBACK = ['127.0.0.1', 'localhost', '::1', '[::1]'];
const RUN = `hr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const PENDING = path.resolve(__dirname, '..', '..', 'migrations_pending');
const SQL_330 = path.join(PENDING, '330_historical_sales_reconciliation.sql');
const SQL_330_RB = path.join(
  PENDING,
  'rollback',
  '330_historical_sales_reconciliation_ROLLBACK.sql',
);

type Fx = { tenantId: string; branchId: string; userId: string };

describe('historical sales reconciliation (330) — dry run, apply, refusal, idempotency, rollback', () => {
  let pg: PgClient;
  const q = async <T = any>(sql: string, p: unknown[] = []): Promise<T[]> =>
    (await pg.query(sql, p)).rows as T[];
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
      throw new Error('suite refuses to run against a non-loopback DB');
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
    await pg.query(fs.readFileSync(SQL_330, 'utf8'));
  }, 60000);
  afterAll(async () => {
    await pg?.end();
  });

  /** Synthetic tenant with full accounting; owner assignment effective from `ownerFrom`. */
  async function tenant(
    label: string,
    opts: { ownerFrom?: string | null; tz?: string } = {},
  ): Promise<Fx> {
    const tenantId = randomUUID();
    const branchId = randomUUID();
    const userId = randomUUID();
    await q(
      'INSERT INTO tenants (id, name, business_type, status, timezone) VALUES ($1,$2,$3,$4,$5)',
      [tenantId, `${RUN}-${label}`, 'retail', 'active', opts.tz ?? 'Asia/Riyadh'],
    );
    await q('INSERT INTO branches (id, tenant_id, name) VALUES ($1,$2,$3)', [
      branchId,
      tenantId,
      'Main',
    ]);
    await q(
      "INSERT INTO users (id, tenant_id, name, email, password_hash, role, is_active) VALUES ($1,$2,'approver',$3,'x','cashier',true)",
      [userId, tenantId, `${RUN}-${label}@example.invalid`],
    );
    const [owner] = await q(
      "INSERT INTO accounting_owners (tenant_id, branch_id, owner_type_code, name, status) VALUES ($1,$2,'branch','Main','active') RETURNING id",
      [tenantId, branchId],
    );
    if (opts.ownerFrom !== null) {
      await q(
        "INSERT INTO branch_accounting_assignments (tenant_id, branch_id, accounting_owner_id, effective_from, reason) VALUES ($1,$2,$3,$4,'hist test')",
        [tenantId, branchId, owner.id, opts.ownerFrom ?? '2020-01-01'],
      );
    }
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
    return { tenantId, branchId, userId };
  }

  /** Historical completed order with NO journal entry (the state of the 144). */
  async function order(
    f: Fx,
    createdAtIso: string,
    o: {
      subtotal?: number;
      discount?: number;
      tax?: number;
      total?: number;
      pm?: string;
      cash?: number | null;
      card?: number | null;
    } = {},
  ): Promise<string> {
    const id = randomUUID();
    const subtotal = o.subtotal ?? 100;
    const discount = o.discount ?? 0;
    const tax = o.tax ?? 0;
    const total = o.total ?? subtotal - discount + tax;
    await q(
      `INSERT INTO orders (id, tenant_id, branch_id, status, subtotal, discount, tax, total, payment_method, cash_amount, card_amount, held, sale_attempt_id, created_at)
       VALUES ($1,$2,$3,'completed',$4,$5,$6,$7,$8,$9,$10,false,$11,$12)`,
      [
        id,
        f.tenantId,
        f.branchId,
        subtotal,
        discount,
        tax,
        total,
        o.pm ?? 'cash',
        o.cash ?? null,
        o.card ?? null,
        randomUUID(),
        createdAtIso,
      ],
    );
    return id;
  }

  const apply = async (
    f: Fx,
    ids: string[],
    label = `${RUN}-approval`,
    expectedTotal?: number,
  ) =>
    q(
      'SELECT * FROM fn_apply_historical_sales_reconciliation($1::uuid[],$2,$3,$4)',
      [ids, f.userId, label, expectedTotal ?? null],
    );
  const jeCount = async (t: string) =>
    (
      await q('SELECT count(*)::int n FROM journal_entries WHERE tenant_id=$1', [
        t,
      ])
    )[0].n as number;
  const auditRows = async (orderId: string) =>
    q(
      'SELECT * FROM historical_sales_reconciliation_audit WHERE order_id=$1 ORDER BY performed_at, id',
      [orderId],
    );
  const entryFor = async (orderId: string) =>
    q(
      "SELECT id, to_char(posting_date,'YYYY-MM-DD') pd, status, posted_by, posted_at FROM journal_entries WHERE source_module='sales' AND source_entity_type='order' AND source_entity_id=$1 AND reversal_of_id IS NULL",
      [orderId],
    );

  // ================================================================ dry run
  describe('(a) dry run', () => {
    it('is read-only, repeatable, lists reasons, and matches what apply then does', async () => {
      const f = await tenant('dry');
      const good = await order(f, '2026-03-10T09:00:00Z', { tax: 15 });
      const noOwner = await tenant('dry-noowner', { ownerFrom: '2026-09-01' });
      const early = await order(noOwner, '2026-03-10T09:00:00Z');
      const before = await jeCount(f.tenantId);
      const auditBefore = (
        await q(
          'SELECT count(*)::int n FROM historical_sales_reconciliation_audit',
        )
      )[0].n;

      const run = () =>
        q(
          'SELECT order_id, decision, reason_code, to_char(posting_date,$3) pd, total::text FROM fn_historical_sales_dry_run($1::uuid[]) WHERE order_id = ANY($2::uuid[]) ORDER BY order_id',
          [[good, early], [good, early], 'YYYY-MM-DD'],
        );
      const r1 = await run();
      const r2 = await run();
      expect(r2).toEqual(r1); // repeatable
      const byId = Object.fromEntries(r1.map((r: any) => [r.order_id, r]));
      expect(byId[good]).toMatchObject({
        decision: 'post',
        reason_code: 'ok',
        pd: '2026-03-10',
      });
      expect(byId[early]).toMatchObject({
        decision: 'refuse',
        reason_code: 'no_accounting_owner_at_date',
      });
      // nothing written
      expect(await jeCount(f.tenantId)).toBe(before);
      expect(
        (
          await q(
            'SELECT count(*)::int n FROM historical_sales_reconciliation_audit',
          )
        )[0].n,
      ).toBe(auditBefore);

      // discovery mode (no list) finds the unposted order for the tenant
      const found = await q(
        'SELECT order_id FROM fn_historical_sales_dry_run(NULL, $1)',
        [f.tenantId],
      );
      expect(found.map((x: any) => x.order_id)).toContain(good);

      // the dry-run function body has no write path
      const src = await q(
        "SELECT prosrc FROM pg_proc WHERE proname IN ('fn_historical_sales_dry_run','fn_historical_sales_preflight')",
      );
      expect(src.length).toBe(2);
      for (const s of src)
        expect(s.prosrc).not.toMatch(
          /\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i,
        );

      const [applied] = await apply(f, [good]);
      expect(applied.action).toBe('posted');
    });
  });

  // ================================================================ apply + idempotency
  describe('(b) apply', () => {
    it('posts through the real engine at the tenant-LOCAL sale date, balanced, with an audit row', async () => {
      const f = await tenant('apply');
      // 21:30Z on 2026-03-10 is already 2026-03-11 in Riyadh
      const id = await order(f, '2026-03-10T21:30:00Z', {
        subtotal: 200,
        discount: 20,
        tax: 27,
        pm: 'mada',
      });
      const [r] = await apply(f, [id], 'owner-approval-test', 207);
      expect(r).toMatchObject({
        action: 'posted',
        reason_code: 'ok',
        order_id: id,
      });
      const [e] = await entryFor(id);
      expect(e.pd).toBe('2026-03-11');
      expect(e.status).toBe('posted');
      expect(e.posted_by).toBe(f.userId);
      const sums = (
        await q(
          'SELECT sum(debit_amount)::text d, sum(credit_amount)::text c FROM journal_lines WHERE journal_entry_id=$1',
          [e.id],
        )
      )[0];
      expect(sums.d).toBe('207.00');
      expect(sums.c).toBe('207.00');
      const roles = await q(
        `SELECT a.role_code, jl.debit_amount::text d, jl.credit_amount::text c FROM journal_lines jl
           JOIN account_role_assignments a ON a.account_id=jl.account_id AND a.tenant_id=jl.tenant_id
          WHERE jl.journal_entry_id=$1 ORDER BY 1`,
        [e.id],
      );
      expect(roles).toEqual([
        { role_code: 'default_bank', d: '207.00', c: '0.00' },
        { role_code: 'sales_revenue', d: '0.00', c: '180.00' },
        { role_code: 'tax_payable', d: '0.00', c: '27.00' },
      ]);
      const a = await auditRows(id);
      expect(a).toHaveLength(1);
      expect(a[0]).toMatchObject({
        action: 'posted',
        run_label: 'owner-approval-test',
        performed_by: f.userId,
        journal_entry_id: e.id,
      });
      expect(a[0].db_role).toBeTruthy();
      expect(a[0].performed_at).toBeTruthy();
    });

    it('double run is a no-op: no second entry, entry untouched, the second attempt is audited as a skip', async () => {
      const f = await tenant('twice');
      const id = await order(f, '2026-04-02T08:00:00Z');
      const [first] = await apply(f, [id]);
      expect(first.action).toBe('posted');
      const [e1] = await entryFor(id);
      const n1 = await jeCount(f.tenantId);
      const lines1 = (
        await q('SELECT count(*)::int n FROM journal_lines WHERE tenant_id=$1', [
          f.tenantId,
        ])
      )[0].n;

      const [second] = await apply(f, [id]);
      expect(second).toMatchObject({
        action: 'skipped_already_posted',
        reason_code: 'already_posted',
        journal_entry_id: null,
      });
      expect(await jeCount(f.tenantId)).toBe(n1);
      expect(
        (
          await q(
            'SELECT count(*)::int n FROM journal_lines WHERE tenant_id=$1',
            [f.tenantId],
          )
        )[0].n,
      ).toBe(lines1);
      const [e2] = await entryFor(id);
      expect(e2).toEqual(e1); // same id, same posted_at: never touched
      expect((await auditRows(id)).map((r: any) => r.action)).toEqual([
        'posted',
        'skipped_already_posted',
      ]);
      // the same id twice inside ONE call is deduplicated
      const id2 = await order(f, '2026-04-03T08:00:00Z');
      const rows = await apply(f, [id2, id2, id2]);
      expect(rows).toHaveLength(1);
      expect(
        (await q('SELECT count(*)::int n FROM journal_entries WHERE source_entity_id=$1', [id2]))[0].n,
      ).toBe(1);
    });

    it('never touches an order already posted by the normal path (or posted then reversed)', async () => {
      const f = await tenant('normal');
      const id = await order(f, '2026-04-05T08:00:00Z');
      await q(
        "SELECT fn_post_sales_order($1,$2,$3,'2026-04-05'::date)",
        [f.tenantId, id, f.userId],
      );
      const [orig] = await entryFor(id);
      const [r] = await apply(f, [id]);
      expect(r.action).toBe('skipped_already_posted');
      expect(await entryFor(id)).toEqual([orig]);

      // posted, then cancelled (reversal exists): the original still counts => skipped, not re-posted
      const id2 = await order(f, '2026-04-06T08:00:00Z');
      await q("SELECT fn_post_sales_order($1,$2,$3,'2026-04-06'::date)", [
        f.tenantId,
        id2,
        f.userId,
      ]);
      await q(
        "UPDATE orders SET status='cancelled', cancelled_at=now() WHERE id=$1",
        [id2],
      );
      await q(
        "SELECT fn_reverse_sales_order($1,$2,$3,'2026-04-07'::date,'x')",
        [f.tenantId, id2, f.userId],
      );
      const n = await jeCount(f.tenantId);
      const [r2] = await apply(f, [id2]);
      expect(r2.action).toBe('skipped_already_posted');
      expect(await jeCount(f.tenantId)).toBe(n);
    });
  });

  // ================================================================ refusals
  describe('refusals: closed/missing periods, owner assignment, data problems — nothing is reopened or created', () => {
    it('closed period => refused, period stays closed, no entry, no draft left behind', async () => {
      const f = await tenant('closed');
      const id = await order(f, '2026-03-10T09:00:00Z');
      await q(
        "UPDATE fiscal_periods SET status='closed' WHERE tenant_id=$1 AND start_date <= '2026-03-10' AND end_date > '2026-03-10'",
        [f.tenantId],
      );
      const [r] = await apply(f, [id]);
      expect(r).toMatchObject({
        action: 'refused',
        reason_code: 'period_not_open',
      });
      expect(await entryFor(id)).toHaveLength(0);
      expect(await jeCount(f.tenantId)).toBe(0);
      const st = await q(
        "SELECT status FROM fiscal_periods WHERE tenant_id=$1 AND start_date <= '2026-03-10' AND end_date > '2026-03-10'",
        [f.tenantId],
      );
      expect(st[0].status).toBe('closed');
      // locked behaves the same
      const id2 = await order(f, '2026-03-11T09:00:00Z');
      await q(
        "UPDATE fiscal_periods SET status='locked' WHERE tenant_id=$1 AND start_date <= '2026-03-10' AND end_date > '2026-03-10'",
        [f.tenantId],
      );
      const [r2] = await apply(f, [id2]);
      expect(r2.reason_code).toBe('period_not_open');
      const a = await auditRows(id);
      expect(a[0]).toMatchObject({ action: 'refused', reason_code: 'period_not_open', journal_entry_id: null });
    });

    it('no fiscal period for the date => refused and NO fiscal year is created (326 safety net is never reached)', async () => {
      const f = await tenant('noperiod');
      const fyBefore = (
        await q('SELECT count(*)::int n FROM fiscal_years WHERE tenant_id=$1', [
          f.tenantId,
        ])
      )[0].n;
      const old = await order(f, '2025-11-10T09:00:00Z'); // before the first year
      const future = await order(f, '2027-02-10T09:00:00Z'); // 326 would auto-extend for this one
      const rows = await apply(f, [old, future]);
      for (const r of rows) {
        expect(r).toMatchObject({
          action: 'refused',
          reason_code: 'no_fiscal_period',
        });
      }
      expect(
        (
          await q('SELECT count(*)::int n FROM fiscal_years WHERE tenant_id=$1', [
            f.tenantId,
          ])
        )[0].n,
      ).toBe(fyBefore);
      expect(await jeCount(f.tenantId)).toBe(0);
    });

    it('no Accounting Owner on the sale date (assignment starts later) => refused; assignments are not back-dated', async () => {
      const f = await tenant('late-owner', { ownerFrom: '2026-08-11' });
      const id = await order(f, '2026-07-01T09:00:00Z');
      const [r] = await apply(f, [id]);
      expect(r).toMatchObject({
        action: 'refused',
        reason_code: 'no_accounting_owner_at_date',
      });
      expect(
        (
          await q(
            'SELECT effective_from::text e FROM branch_accounting_assignments WHERE tenant_id=$1',
            [f.tenantId],
          )
        ).map((x: any) => x.e),
      ).toEqual(['2026-08-11']);
      // a sale on/after the assignment date posts
      const ok = await order(f, '2026-08-12T09:00:00Z');
      expect((await apply(f, [ok]))[0].action).toBe('posted');
    });

    it('data problems are refused with a reason: totals mismatch, split without breakdown, return recorded, deleted, not completed, tab without customer, free sale skipped', async () => {
      const f = await tenant('data');
      const mism = await order(f, '2026-05-01T09:00:00Z', {
        subtotal: 36,
        total: 31,
      });
      const split = await order(f, '2026-05-02T09:00:00Z', { pm: 'split' });
      const tab = await order(f, '2026-05-03T09:00:00Z', { pm: 'tab' });
      const del = await order(f, '2026-05-04T09:00:00Z');
      await q('UPDATE orders SET deleted_at=now() WHERE id=$1', [del]);
      const pend = await order(f, '2026-05-05T09:00:00Z');
      await q("UPDATE orders SET status='pending' WHERE id=$1", [pend]);
      const free = await order(f, '2026-05-06T09:00:00Z', {
        subtotal: 10,
        discount: 10,
        total: 0,
      });
      const ret = await order(f, '2026-05-07T09:00:00Z');
      await q(
        "INSERT INTO sales_returns (tenant_id, branch_id, order_id, refund_method, net_amount, tax_amount, refund_total, refund_cash, refund_noncash) VALUES ($1,$2,$3,'cash',100,0,100,100,0)",
        [f.tenantId, f.branchId, ret],
      ).catch(async () => {
        // schema variants: fall back to the minimum the table requires
        await q(
          'INSERT INTO sales_returns (tenant_id, branch_id, order_id, refund_total) VALUES ($1,$2,$3,100)',
          [f.tenantId, f.branchId, ret],
        );
      });
      const rows = await apply(f, [mism, split, tab, del, pend, free, ret]);
      const code = Object.fromEntries(rows.map((r: any) => [r.order_id, r]));
      expect(code[mism]).toMatchObject({ action: 'refused', reason_code: 'totals_do_not_reconcile' });
      expect(code[split]).toMatchObject({ action: 'refused', reason_code: 'split_breakdown_missing' });
      expect(code[tab]).toMatchObject({ action: 'refused', reason_code: 'tab_without_customer' });
      expect(code[del]).toMatchObject({ action: 'refused', reason_code: 'order_deleted' });
      expect(code[pend]).toMatchObject({ action: 'refused', reason_code: 'not_completed' });
      expect(code[free]).toMatchObject({ action: 'skipped_nothing_to_post', reason_code: 'nothing_to_post' });
      expect(code[ret]).toMatchObject({ action: 'refused', reason_code: 'sales_return_exists' });
      expect(await jeCount(f.tenantId)).toBe(0);
    });

    it('stock-tracked items without a stock movement post revenue only and flag requires_cogs_reconciliation (no invented COGS)', async () => {
      const f = await tenant('tracked');
      const [item] = await q(
        "INSERT INTO items (tenant_id, name, type, operation_type, price, has_inventory) VALUES ($1,'tracked','product','sell',10,true) RETURNING id",
        [f.tenantId],
      );
      const id = await order(f, '2026-05-10T09:00:00Z', { subtotal: 10 });
      await q(
        'INSERT INTO order_items (order_id, item_id, item_name, qty, price, total_price) VALUES ($1,$2,$3,1,10,10)',
        [id, item.id, 'tracked'],
      );
      const dry = await q(
        'SELECT reason_code, tracked_without_stock_movement t, expected_cogs::text c FROM fn_historical_sales_dry_run($1::uuid[])',
        [[id]],
      );
      expect(dry[0]).toEqual({ reason_code: 'ok_cogs_unknown', t: true, c: '0' });
      const [r] = await apply(f, [id]);
      expect(r).toMatchObject({ action: 'posted', reason_code: 'ok_cogs_unknown' });
      const [e] = await q(
        "SELECT requires_cogs_reconciliation r FROM journal_entries WHERE source_entity_id=$1 AND source_module='sales'",
        [id],
      );
      expect(e.r).toBe(true);
    });
  });

  // ================================================================ mixed batch
  describe('mixed good/bad batch', () => {
    it('one failing order (engine error) does not abort the batch; its partial work is undone; the rest post', async () => {
      const f = await tenant('mixed');
      const g1 = await order(f, '2026-06-01T09:00:00Z');
      const closedDay = await order(f, '2026-02-10T09:00:00Z');
      await q(
        "UPDATE fiscal_periods SET status='closed' WHERE tenant_id=$1 AND start_date <= '2026-02-10' AND end_date > '2026-02-10'",
        [f.tenantId],
      );
      // engine-level failure the pre-flight cannot see: the tax account is deactivated AFTER role assignment
      const badTax = await order(f, '2026-06-02T09:00:00Z', { tax: 15 });
      await q("SET session_replication_role = 'replica'"); // bypass the system-account guard: legacy-bad data
      try {
        await q(
          "UPDATE accounts SET is_active=false WHERE tenant_id=$1 AND code='2200'",
          [f.tenantId],
        );
      } finally {
        await q("SET session_replication_role = 'origin'");
      }
      const g2 = await order(f, '2026-06-03T09:00:00Z'); // no tax: unaffected
      const posted = await order(f, '2026-06-04T09:00:00Z');
      await q("SELECT fn_post_sales_order($1,$2,$3,'2026-06-04'::date)", [
        f.tenantId,
        posted,
        f.userId,
      ]);
      const unknown = randomUUID();

      const rows = await apply(f, [g1, closedDay, badTax, g2, posted, unknown]);
      const by: Record<string, any> = Object.fromEntries(
        rows.map((r: any) => [r.order_id, r]),
      );
      expect(by[g1].action).toBe('posted');
      expect(by[g2].action).toBe('posted');
      expect(by[closedDay]).toMatchObject({ action: 'refused', reason_code: 'period_not_open' });
      expect(by[badTax]).toMatchObject({ action: 'failed', reason_code: 'engine_error' });
      expect(by[badTax].reason_detail).toMatch(/inactive|invalid/);
      expect(by[posted].action).toBe('skipped_already_posted');
      expect(by[unknown]).toMatchObject({ action: 'refused', reason_code: 'order_not_found' });

      // failed order: no entry, no leftover draft, but the failure IS audited
      expect(await entryFor(badTax)).toHaveLength(0);
      expect(
        (
          await q(
            "SELECT count(*)::int n FROM journal_entries WHERE tenant_id=$1 AND status='draft'",
            [f.tenantId],
          )
        )[0].n,
      ).toBe(0);
      expect((await auditRows(badTax))[0]).toMatchObject({ action: 'failed', journal_entry_id: null });
      // run summary view agrees with the audit
      const [s] = await q(
        'SELECT posted_orders::int p, refused::int r, failed::int f, skipped_already_posted::int s, revenue_credited::text rev FROM v_historical_sales_reconciliation_run WHERE run_label=$1 AND tenant_id=$2',
        [`${RUN}-approval`, f.tenantId],
      );
      expect(s).toEqual({ p: 2, r: 1, f: 1, s: 1, rev: '200.00' });
    });

    it('verification view: before = still-unposted + reconciled; after shrinks by exactly the posted orders', async () => {
      const f = await tenant('view');
      const a = await order(f, '2026-07-01T09:00:00Z', { subtotal: 100, tax: 15 });
      await order(f, '2026-07-02T09:00:00Z', { subtotal: 50 }); // stays unposted
      const get = async () =>
        (
          await q(
            `SELECT unposted_orders_now::int un, unposted_total_now::text ut, reconciled_orders::int ro, reconciled_total::text rt,
                    unposted_orders_before::int ub, unposted_total_before::text tb
               FROM v_historical_sales_reconciliation WHERE tenant_id=$1 AND sale_month='2026-07'`,
            [f.tenantId],
          )
        )[0];
      expect(await get()).toEqual({ un: 2, ut: '165.00', ro: 0, rt: '0', ub: 2, tb: '165.00' });
      await apply(f, [a]);
      expect(await get()).toEqual({ un: 1, ut: '50.00', ro: 1, rt: '115.00', ub: 2, tb: '165.00' });
    });
  });

  // ================================================================ input validation
  describe('input validation: nothing happens on a bad request', () => {
    it('rejects empty/null list, missing label, unknown approver, total mismatch — no entries, no audit', async () => {
      const f = await tenant('valid');
      const id = await order(f, '2026-07-05T09:00:00Z');
      const auditN = async () =>
        (
          await q(
            'SELECT count(*)::int n FROM historical_sales_reconciliation_audit',
          )
        )[0].n;
      const n0 = await auditN();
      await expect(apply(f, [])).rejects.toThrow(/explicit non-empty approved order list/);
      await expect(
        q('SELECT * FROM fn_apply_historical_sales_reconciliation(NULL,$1,$2)', [f.userId, 'x']),
      ).rejects.toThrow(/explicit non-empty/);
      await expect(apply(f, [id], '   ')).rejects.toThrow(/run_label/);
      await expect(
        q('SELECT * FROM fn_apply_historical_sales_reconciliation($1::uuid[],$2,$3)', [[id], randomUUID(), 'x']),
      ).rejects.toThrow(/approved_by/);
      await expect(apply(f, [id], 'x', 999)).rejects.toThrow(/does not match the list total/);
      await expect(
        apply(f, Array.from({ length: 501 }, () => randomUUID())),
      ).rejects.toThrow(/1\.\.500/);
      expect(await jeCount(f.tenantId)).toBe(0);
      expect(await auditN()).toBe(n0);
    });
  });

  // ================================================================ concurrency
  describe('concurrency', () => {
    it('two simultaneous applies of the same order produce exactly one entry', async () => {
      const f = await tenant('race');
      const ids = await Promise.all(
        Array.from({ length: 4 }, (_, i) =>
          order(f, `2026-07-1${i}T09:00:00Z`),
        ),
      );
      const run = () =>
        withClient(async (c) =>
          (
            await c.query(
              'SELECT * FROM fn_apply_historical_sales_reconciliation($1::uuid[],$2,$3)',
              [ids, f.userId, `${RUN}-race`],
            )
          ).rows,
        );
      const [a, b] = await Promise.all([run(), run()]);
      const all = [...a, ...b];
      expect(all.filter((r: any) => r.action === 'posted')).toHaveLength(4);
      expect(
        all.filter((r: any) => r.action === 'skipped_already_posted'),
      ).toHaveLength(4);
      for (const id of ids) expect(await entryFor(id)).toHaveLength(1);
      expect(await jeCount(f.tenantId)).toBe(4);
    });

    it('the unique index is the last line of defence: a second original entry for the same order is impossible', async () => {
      const f = await tenant('uq');
      const id = await order(f, '2026-07-20T09:00:00Z');
      await apply(f, [id]);
      const [e] = await entryFor(id);
      const [book] = await q(
        'SELECT accounting_book_id b FROM journal_entries WHERE id=$1',
        [e.id],
      );
      await expect(
        q(
          "INSERT INTO journal_entries (tenant_id, accounting_book_id, posting_date, document_date, source_module, source_entity_type, source_entity_id) VALUES ($1,$2,'2026-07-20','2026-07-20','sales','order',$3)",
          [f.tenantId, book.b, id],
        ),
      ).rejects.toThrow(/uq_journal_entries_source|duplicate key/);
    });
  });

  // ================================================================ audit immutability
  describe('audit is append-only', () => {
    it('UPDATE, DELETE and TRUNCATE are rejected', async () => {
      const f = await tenant('audit');
      const id = await order(f, '2026-07-22T09:00:00Z');
      await apply(f, [id]);
      await expect(
        q("UPDATE historical_sales_reconciliation_audit SET reason_code='x' WHERE order_id=$1", [id]),
      ).rejects.toThrow(/append-only/);
      await expect(
        q('DELETE FROM historical_sales_reconciliation_audit WHERE order_id=$1', [id]),
      ).rejects.toThrow(/append-only/);
      await expect(
        q('TRUNCATE historical_sales_reconciliation_audit'),
      ).rejects.toThrow(/append-only/);
      expect(await auditRows(id)).toHaveLength(1);
    });

    it('grants: only service_role can execute / read; anon and authenticated cannot', async () => {
      const rows = await q(
        `SELECT p.proname,
                has_function_privilege('anon', p.oid, 'EXECUTE') anon,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') auth,
                has_function_privilege('service_role', p.oid, 'EXECUTE') svc
           FROM pg_proc p WHERE p.proname IN ('fn_apply_historical_sales_reconciliation','fn_historical_sales_dry_run','fn_historical_sales_preflight')`,
      );
      expect(rows).toHaveLength(3);
      for (const r of rows) expect(r).toMatchObject({ anon: false, auth: false, svc: true });
      const [t] = await q(
        "SELECT has_table_privilege('anon','historical_sales_reconciliation_audit','SELECT') a, has_table_privilege('authenticated','historical_sales_reconciliation_audit','SELECT') u",
      );
      expect(t).toEqual({ a: false, u: false });
    });
  });

  // ================================================================ rollback (kept LAST: removes the objects, then re-applies)
  describe('rollback', () => {
    it('removes functions and views, KEEPS a non-empty audit table, leaves posted entries alone, and 330 can be re-applied', async () => {
      const f = await tenant('rollback');
      const id = await order(f, '2026-07-25T09:00:00Z');
      await apply(f, [id]);
      const [e] = await entryFor(id);
      const auditN = (
        await q('SELECT count(*)::int n FROM historical_sales_reconciliation_audit')
      )[0].n;
      expect(auditN).toBeGreaterThan(0);

      await pg.query(fs.readFileSync(SQL_330_RB, 'utf8'));
      const gone = await q(
        `SELECT
           (SELECT count(*)::int FROM pg_proc WHERE proname IN ('fn_apply_historical_sales_reconciliation','fn_historical_sales_dry_run','fn_historical_sales_preflight')) fns,
           (SELECT count(*)::int FROM pg_views WHERE viewname IN ('v_historical_sales_reconciliation','v_historical_sales_reconciliation_run')) views,
           to_regclass('public.historical_sales_reconciliation_audit') IS NOT NULL audit_kept`,
      );
      expect(gone[0]).toEqual({ fns: 0, views: 0, audit_kept: true });
      expect(
        (await q('SELECT count(*)::int n FROM historical_sales_reconciliation_audit'))[0].n,
      ).toBe(auditN);
      // posted entry untouched by the rollback
      expect(await entryFor(id)).toEqual([e]);
      // rollback is itself repeatable
      await pg.query(fs.readFileSync(SQL_330_RB, 'utf8'));

      // re-apply 330 (idempotent), the mechanism works again and the old audit is still there
      await pg.query(fs.readFileSync(SQL_330, 'utf8'));
      await pg.query(fs.readFileSync(SQL_330, 'utf8')); // twice
      const id2 = await order(f, '2026-07-26T09:00:00Z');
      expect((await apply(f, [id2]))[0].action).toBe('posted');
      expect(
        (await q('SELECT count(*)::int n FROM historical_sales_reconciliation_audit'))[0].n,
      ).toBe(auditN + 1);
    });
  });
});
