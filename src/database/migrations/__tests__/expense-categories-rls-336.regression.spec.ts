/**
 * R-RLS: migrations_pending/336_expense_categories_enable_rls.sql (LOCAL disposable DB only).
 * Production had RLS disabled on expense_categories with full anon privileges. Proves: before 336 the exposure exists
 * (the spec re-creates it), after 336 RLS is on, anon/authenticated have no privilege, service_role still works,
 * a second run is a no-op, and the rollback restores the previous state.
 */
import * as fs from 'fs';
import * as path from 'path';
import { Client as PgClient } from 'pg';

const LOOPBACK = ['127.0.0.1', 'localhost', '::1', '[::1]'];
const PENDING = path.resolve(__dirname, '..', '..', 'migrations_pending');
const read = (f: string) => fs.readFileSync(path.join(PENDING, f), 'utf8');

describe('336 expense_categories RLS + privileges', () => {
  let pg: PgClient;
  const state = async () =>
    (
      await pg.query(
        `SELECT c.relrowsecurity AS rls,
                has_table_privilege('anon', c.oid, 'SELECT') AS anon_sel,
                has_table_privilege('anon', c.oid, 'INSERT') AS anon_ins,
                has_table_privilege('authenticated', c.oid, 'SELECT') AS auth_sel,
                has_table_privilege('service_role', c.oid, 'SELECT') AS svc_sel,
                has_table_privilege('service_role', c.oid, 'INSERT') AS svc_ins
           FROM pg_class c WHERE c.oid = 'public.expense_categories'::regclass`,
      )
    ).rows[0];

  beforeAll(async () => {
    const host = new URL(process.env.DATABASE_URL ?? 'postgres://invalid').hostname;
    if (!LOOPBACK.includes(host)) throw new Error('refuses to run against a non-loopback DB');
    pg = new PgClient({ connectionString: process.env.DATABASE_URL });
    await pg.connect();
  });
  afterAll(async () => {
    await pg.query(read('336_expense_categories_enable_rls.sql')); // leave the shared test DB in the integrated state
    await pg.end();
  });

  it('reproduces the production exposure, then 336 closes it', async () => {
    await pg.query(read('rollback/336_expense_categories_enable_rls_ROLLBACK.sql'));
    const exposed = await state();
    expect(exposed.rls).toBe(false);
    expect(exposed.anon_sel && exposed.anon_ins && exposed.auth_sel).toBe(true);

    await pg.query(read('336_expense_categories_enable_rls.sql'));
    const closed = await state();
    expect(closed.rls).toBe(true);
    expect(closed.anon_sel || closed.anon_ins || closed.auth_sel).toBe(false);
    expect(closed.svc_sel && closed.svc_ins).toBe(true); // the API (service_role) is unaffected
  });

  it('is idempotent (second run changes nothing)', async () => {
    const a = await state();
    await pg.query(read('336_expense_categories_enable_rls.sql'));
    expect(await state()).toEqual(a);
  });

  it('the rollback restores the previous (exposed) state', async () => {
    await pg.query(read('rollback/336_expense_categories_enable_rls_ROLLBACK.sql'));
    const s = await state();
    expect(s.rls).toBe(false);
    expect(s.anon_sel).toBe(true);
    await pg.query(read('336_expense_categories_enable_rls.sql'));
  });
});
