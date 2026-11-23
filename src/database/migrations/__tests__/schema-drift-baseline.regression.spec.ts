/**
 * WP-C - migrations_pending/331_schema_drift_baseline.sql
 *
 * LOCAL DISPOSABLE DATABASE ONLY. Builds a SCRATCH database on the loopback server (named by this run),
 * applies bootstrap + every migration + every pending migration EXCEPT 331, then proves:
 *   - the drift exists before 331 (tenants.tax_rate etc. are missing),
 *   - 331 creates exactly the expected objects with the production definitions,
 *   - a second run is a no-op (introspected schema identical),
 *   - 331 contains no data statements,
 *   - the rollback returns the schema to the pre-331 state.
 */
import * as fs from 'fs';
import * as path from 'path';
import { Client as PgClient } from 'pg';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const drift = require('../../../../scripts/schema-drift.js') as {
  introspect: (c: PgClient) => Promise<Record<string, Record<string, string>>>;
  compareSchemas: (
    a: Record<string, Record<string, string>>,
    b: Record<string, Record<string, string>>,
  ) => { category: string; key: string; kind: string }[];
};

const LOOPBACK = ['127.0.0.1', 'localhost', '::1', '[::1]'];
const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const MIGRATIONS = path.join(ROOT, 'src/database/migrations');
const PENDING = path.join(ROOT, 'src/database/migrations_pending');
const BASELINE = '331_schema_drift_baseline.sql';
const ROLLBACK = path.join(PENDING, 'rollback', '331_schema_drift_baseline_ROLLBACK.sql');

describe('331 schema drift baseline (scratch database)', () => {
  jest.setTimeout(300_000); // catalog introspection / DDL can be slow on a loaded machine
  const dbName = `sefay_baseline_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  let admin: PgClient;
  let db: PgClient;
  let before: Record<string, Record<string, string>>;
  let after: Record<string, Record<string, string>>;
  const baselineSql = fs.readFileSync(path.join(PENDING, BASELINE), 'utf8');

  beforeAll(async () => {
    const adminUrl = process.env.DATABASE_URL as string;
    expect(LOOPBACK).toContain(new URL(adminUrl).hostname);
    admin = new PgClient({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    const u = new URL(adminUrl);
    u.pathname = `/${dbName}`;
    db = new PgClient({ connectionString: u.toString() });
    await db.connect();

    await db.query(fs.readFileSync(path.join(ROOT, 'test/local-db/bootstrap.sql'), 'utf8'));
    const files = [
      ...fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).map((f) => path.join(MIGRATIONS, f)),
      ...fs
        .readdirSync(PENDING)
        .filter((f) => f.endsWith('.sql') && f !== BASELINE)
        .map((f) => path.join(PENDING, f)),
    ].sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
    for (const f of files) await db.query(fs.readFileSync(f, 'utf8'));
    before = await drift.introspect(db);
  }, 900_000);

  afterAll(async () => {
    await db?.end().catch(() => undefined);
    await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => undefined);
    await admin?.end().catch(() => undefined);
  }, 60_000);

  it('the drift exists before the baseline (columns read by code but created by no migration)', () => {
    expect(before.columns['tenants.tax_rate']).toBeUndefined();
    expect(before.columns['tenants.currency_symbol']).toBeUndefined();
    expect(before.columns['tenants.currency_code']).toBeUndefined();
    expect(before.columns['expense_templates.recurrence_type']).toBeUndefined();
  });

  it('applies on a fresh database and produces the production definitions', async () => {
    await db.query(baselineSql);
    after = await drift.introspect(db);
    expect(after.columns['tenants.tax_rate']).toBe(
      'numeric(5,4) | not_null=true | default=0.15 | identity= | generated=',
    );
    expect(after.columns['tenants.currency_code']).toBe(
      "character varying(10) | not_null=false | default='SAR'::character varying | identity= | generated=",
    );
    expect(after.columns['tenants.currency_symbol']).toContain('character varying(10) | not_null=false');
    expect(after.columns['tenants.currency_symbol']).toContain('⃁');
    expect(after.columns['features.category']).toBe(
      "character varying(20) | not_null=true | default='core'::character varying | identity= | generated=",
    );
    expect(after.columns['expense_templates.recurrence_type']).toContain('text | not_null=true');
    expect(after.constraints['expense_templates.expense_templates_recurrence_type_check']).toBeDefined();
    expect(after.constraints['features.features_category_check']).toBeDefined();
    expect(after.constraints['expenses.expenses_status_check']).toContain('cancelled');
    expect(after.policies['expense_categories.tenant_isolation_expense_categories']).toMatch(/check=\(tenant_id/);
    expect(after.rls.user_roles).toBe('rls=true force=false');
    expect(after.rls.backorders).toBe('rls=true force=false');
  });

  it('changes only what it claims to change', () => {
    const changed = drift.compareSchemas(before, after).map((d) => `${d.category}:${d.key}:${d.kind}`);
    expect(changed.filter((c) => !/^(columns|constraints|policies|rls|indexes):/.test(c))).toEqual([]);
    expect(changed.some((c) => c.startsWith('tables:') || c.startsWith('functions:'))).toBe(false);
    expect(changed.filter((c) => c.endsWith(':only_in_migrations'))).toEqual([]); // nothing removed
  });

  it('is a no-op on a second run (idempotent)', async () => {
    await db.query(baselineSql);
    await db.query(baselineSql);
    const again = await drift.introspect(db);
    expect(drift.compareSchemas(after, again)).toEqual([]);
  });

  it('contains no data statements', () => {
    const code = baselineSql.replace(/--[^\n]*/g, '');
    expect(code).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(code).not.toMatch(/\bCOPY\b/i);
    expect(code).not.toMatch(/\bDROP\s+(TABLE|COLUMN)\b/i);
    expect(code).not.toMatch(/\bTRUNCATE\b/i);
  });

  it('rollback restores the pre-331 schema (scratch databases only)', async () => {
    await db.query(fs.readFileSync(ROLLBACK, 'utf8'));
    const rolled = await drift.introspect(db);
    expect(drift.compareSchemas(before, rolled)).toEqual([]);
  });

  it('can be re-applied after a rollback', async () => {
    await db.query(baselineSql);
    const again = await drift.introspect(db);
    expect(drift.compareSchemas(after, again)).toEqual([]);
  });
});
