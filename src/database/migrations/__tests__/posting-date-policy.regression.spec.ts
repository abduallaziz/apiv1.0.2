/**
 * WP-B follow-up — proposed single posting-date policy (migration 327, pending, NOT wired).
 * LOCAL DISPOSABLE DATABASE ONLY (`npm run test:integration:local`). Loopback-guarded.
 * Requires 325 + 326 + 327 on the local database (this suite applies 327 itself, idempotently).
 * Same disclosed leftovers as fiscal-year-continuity.regression.spec.ts (append-only data).
 */
import * as fs from 'fs';
import * as path from 'path';
import { Client as PgClient } from 'pg';
import { randomUUID } from 'crypto';

const LOOPBACK = ['127.0.0.1', 'localhost', '::1', '[::1]'];
const RUN = `pd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

describe('posting-date policy (proposal) — tenant-local date, one rule for sale/cancel/return', () => {
  let pg: PgClient;
  async function q<T = any>(sql: string, p: unknown[] = []): Promise<T[]> {
    return (await pg.query(sql, p)).rows as T[];
  }

  beforeAll(async () => {
    const host = new URL(process.env.DATABASE_URL ?? 'postgres://invalid')
      .hostname;
    if (!LOOPBACK.includes(host)) {
      throw new Error('policy suite refuses to run against a non-loopback DB');
    }
    pg = new PgClient({ connectionString: process.env.DATABASE_URL });
    await pg.connect();
    await pg.query(
      fs.readFileSync(
        path.resolve(
          __dirname,
          '..',
          '..',
          'migrations_pending',
          '327_posting_date_policy.sql',
        ),
        'utf8',
      ),
    );
  }, 60000);
  afterAll(async () => {
    await pg?.end();
  });

  async function tenant(tz: string, label: string): Promise<string> {
    const id = randomUUID();
    await q(
      'INSERT INTO tenants (id, name, business_type, status, timezone) VALUES ($1,$2,$3,$4,$5)',
      [id, `${RUN}-${label}`, 'retail', 'active', tz],
    );
    return id;
  }
  const d = async (t: string, kind: string, at: string, orig?: string) =>
    (
      await q(
        "SELECT to_char(fn_posting_date_for_event($1,$2,$3::timestamptz,$4::date),'YYYY-MM-DD') AS d",
        [t, kind, at, orig ?? null],
      )
    )[0].d;

  it('sale: Riyadh 00:30 on 1 Jan 2027 (21:30Z on 31 Dec) posts on 2027-01-01, the day the cashier saw', async () => {
    const t = await tenant('Asia/Riyadh', 'sale');
    expect(await d(t, 'sale', '2026-12-31T21:30:00Z')).toBe('2027-01-01');
    expect(await d(t, 'sale', '2026-12-31T20:59:59Z')).toBe('2026-12-31');
  });

  it('cancel and return use the SAME tenant-local rule as the sale (no UTC/app-clock split)', async () => {
    const t = await tenant('Asia/Riyadh', 'same');
    const at = '2026-12-31T21:10:00Z';
    const sale = await d(t, 'sale', at);
    expect(await d(t, 'cancel', at)).toBe(sale);
    expect(await d(t, 'return', at)).toBe(sale);
  });

  it('a reversal/return is never dated before the entry it reverses', async () => {
    const t = await tenant('Asia/Riyadh', 'floor');
    // event clock earlier than the original posting date (clock skew / back-dated import)
    expect(await d(t, 'cancel', '2026-12-30T10:00:00Z', '2026-12-31')).toBe(
      '2026-12-31',
    );
    expect(await d(t, 'return', '2027-01-05T10:00:00Z', '2026-12-31')).toBe(
      '2027-01-05',
    );
  });

  it('time zones behind UTC: Los Angeles 23:30 on 31 Dec is still 31 Dec (UTC would say 1 Jan)', async () => {
    const t = await tenant('America/Los_Angeles', 'la');
    expect(await d(t, 'sale', '2027-01-01T07:30:00Z')).toBe('2026-12-31');
    expect(await d(t, 'sale', '2027-01-01T08:00:00Z')).toBe('2027-01-01');
  });

  it('unknown or missing tenant time zone falls back to UTC instead of failing', async () => {
    const bad = await tenant('Not/AZone', 'bad');
    const none = await tenant('', 'none');
    expect(await d(bad, 'sale', '2026-12-31T23:59:59Z')).toBe('2026-12-31');
    expect(await d(none, 'sale', '2026-12-31T23:59:59Z')).toBe('2026-12-31');
  });

  it('rejects an unknown kind and a missing event time (never guesses a date)', async () => {
    const t = await tenant('Asia/Riyadh', 'inv');
    await expect(
      q("SELECT fn_posting_date_for_event($1,'refund',now())", [t]),
    ).rejects.toThrow(/unknown kind/);
    await expect(
      q("SELECT fn_posting_date_for_event($1,'sale',NULL)", [t]),
    ).rejects.toThrow(/event time is required/);
  });

  it('drift report lists only the orders whose date would change (near local midnight), read-only', async () => {
    const t = await tenant('Asia/Riyadh', 'drift');
    const [b] = await q<{ id: string }>(
      'INSERT INTO branches (id, tenant_id, name) VALUES ($1,$2,$3) RETURNING id',
      [randomUUID(), t, 'Main'],
    );
    const ins = (iso: string) =>
      q(
        "INSERT INTO orders (id, tenant_id, branch_id, status, subtotal, discount, tax, total, payment_method, held, sale_attempt_id, created_at) VALUES ($1,$2,$3,'completed',10,0,0,10,'cash',false,$4,$5)",
        [randomUUID(), t, b.id, randomUUID(), iso],
      );
    await ins('2026-12-31T21:30:00Z'); // drifts under a UTC session
    await ins('2026-12-31T10:00:00Z'); // same day both ways
    await ins('2026-06-10T22:30:00Z'); // drifts
    const before = (
      await q('SELECT count(*)::int n FROM orders WHERE tenant_id=$1', [t])
    )[0].n;
    const rows = await q(
      "SELECT order_id, to_char(current_rule_date,'YYYY-MM-DD') cur, to_char(policy_date,'YYYY-MM-DD') pol FROM fn_posting_date_drift($1,'2026-01-01','2027-12-31')",
      [t],
    );
    const [{ tz }] = await q("SELECT current_setting('TimeZone') AS tz");
    if (tz === 'UTC' || tz === 'Etc/UTC') {
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => `${r.cur}>${r.pol}`).sort()).toEqual([
        '2026-06-10>2026-06-11',
        '2026-12-31>2027-01-01',
      ]);
    }
    expect(
      (await q('SELECT count(*)::int n FROM orders WHERE tenant_id=$1', [t]))[0]
        .n,
    ).toBe(before); // read-only
  });

  it('closed periods stay closed: the policy only chooses a date, the engine still refuses a closed period (fail-closed, nothing back-dated)', async () => {
    const t = await tenant('Asia/Riyadh', 'closed');
    const date = await d(t, 'cancel', '2026-12-31T10:00:00Z', '2026-12-30');
    expect(date).toBe('2026-12-31');
    // behavioural proof of the engine refusal is in fiscal-year-continuity (closed period never reopened /
    // posting into a closed period raises); the policy function takes no write path.
    const [{ prosrc }] = await q(
      "SELECT prosrc FROM pg_proc WHERE proname='fn_posting_date_for_event'",
    );
    expect(prosrc).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
  });
});
