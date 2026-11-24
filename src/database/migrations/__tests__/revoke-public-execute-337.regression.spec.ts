/**
 * R-FN: migrations_pending/337_revoke_public_execute_security_definer.sql (LOCAL disposable DB only).
 * Production let anon/authenticated EXECUTE the SECURITY DEFINER functions fn_create_sales_return and fn_close_shift.
 * Proves: the exposure is reproducible, 337 removes it for every overload, service_role keeps EXECUTE, a second run
 * is a no-op, and the rollback restores the previous grants.
 */
import * as fs from 'fs';
import * as path from 'path';
import { Client as PgClient } from 'pg';

const LOOPBACK = ['127.0.0.1', 'localhost', '::1', '[::1]'];
const PENDING = path.resolve(__dirname, '..', '..', 'migrations_pending');
const read = (f: string) => fs.readFileSync(path.join(PENDING, f), 'utf8');
const FNS = ['fn_create_sales_return', 'fn_close_shift'];

describe('337 revoke public EXECUTE on SECURITY DEFINER functions', () => {
  let pg: PgClient;
  const state = async () =>
    (
      await pg.query(
        `SELECT p.proname,
                has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_x,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_x,
                has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc_x
           FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY($1)
          ORDER BY p.oid`,
        [FNS],
      )
    ).rows;

  beforeAll(async () => {
    const host = new URL(process.env.DATABASE_URL ?? 'postgres://invalid').hostname;
    if (!LOOPBACK.includes(host)) throw new Error('refuses to run against a non-loopback DB');
    pg = new PgClient({ connectionString: process.env.DATABASE_URL });
    await pg.connect();
  });
  afterAll(async () => {
    await pg.query(read('337_revoke_public_execute_security_definer.sql')); // leave the shared DB in the integrated state
    await pg.end();
  });

  it('reproduces the exposure, then 337 closes it for every overload', async () => {
    await pg.query(read('rollback/337_revoke_public_execute_security_definer_ROLLBACK.sql'));
    const exposed = await state();
    expect(exposed.length).toBeGreaterThanOrEqual(2);
    expect(exposed.every((r) => r.anon_x && r.auth_x && r.svc_x)).toBe(true);

    await pg.query(read('337_revoke_public_execute_security_definer.sql'));
    const closed = await state();
    expect(closed.every((r) => !r.anon_x && !r.auth_x)).toBe(true);
    expect(closed.every((r) => r.svc_x)).toBe(true); // the API (service_role) is unaffected
  });

  it('is idempotent', async () => {
    const a = await state();
    await pg.query(read('337_revoke_public_execute_security_definer.sql'));
    expect(await state()).toEqual(a);
  });

  it('the rollback restores the previous (exposed) grants', async () => {
    await pg.query(read('rollback/337_revoke_public_execute_security_definer_ROLLBACK.sql'));
    expect((await state()).every((r) => r.anon_x)).toBe(true);
    await pg.query(read('337_revoke_public_execute_security_definer.sql'));
  });
});
