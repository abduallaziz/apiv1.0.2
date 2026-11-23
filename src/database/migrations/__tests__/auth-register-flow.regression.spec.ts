/**
 * WP-A closure — impact of the R-01 fix on registration, authentication,
 * legitimate roles and JWT issue/refresh. LOCAL DISPOSABLE DATABASE ONLY
 * (`npm run test:integration:local`). Refuses to run unless every connection
 * is loopback. Requires migration 324 on the local DB.
 *
 * Disclosed leftovers: a registered tenant runs the accounting bootstrap, and
 * fiscal years/periods are append-only (migration 179), so the tenants this
 * suite registers cannot be deleted. They are tagged with the run id and live
 * only in the disposable local database.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Client as PgClient } from 'pg';
import * as jwt from 'jsonwebtoken';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../../../modules/auth/auth.service';
import { AccountingBootstrapService } from '../../../modules/auth/accounting-bootstrap.service';
import { AuditService } from '../../../core/audit/audit.service';
import { BranchValidatorService } from '../../../core/security/branch-validator.service';

const LOOPBACK = ['127.0.0.1', 'localhost', '::1', '[::1]'];
const SECRET = 'r01-register-local-only-secret-0123456789abcdef';
const RUN = `reg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

describe('R-01 impact — registration, login, refresh and JWT claims (real AuthService)', () => {
  let pg: PgClient;
  let supabase: SupabaseClient;
  let auth: AuthService;
  const email = `${RUN}@reg.invalid`;
  const password = 'Passw0rd!1';
  let registered: Awaited<ReturnType<AuthService['register']>>;

  const decode = (t: string) => jwt.verify(t, SECRET) as Record<string, any>;
  async function q<T = any>(sql: string, p: unknown[] = []): Promise<T[]> {
    return (await pg.query(sql, p)).rows as T[];
  }

  beforeAll(async () => {
    const dbHost = new URL(process.env.DATABASE_URL ?? 'postgres://invalid').hostname;
    const apiHost = new URL(process.env.SUPABASE_URL ?? 'http://invalid').hostname;
    if (!LOOPBACK.includes(dbHost) || !LOOPBACK.includes(apiHost)) {
      throw new Error('registration suite refuses to run against a non-loopback database');
    }
    pg = new PgClient({ connectionString: process.env.DATABASE_URL });
    await pg.connect();
    supabase = createClient(process.env.SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string, {
      auth: { persistSession: false },
    });
    // register() needs an active plan
    await q("INSERT INTO plans (name, is_active) SELECT 'r01-local-plan', true WHERE NOT EXISTS (SELECT 1 FROM plans WHERE is_active)");

    auth = new AuthService(
      supabase,
      new AccountingBootstrapService(supabase),
      new JwtService({ secret: SECRET, signOptions: { expiresIn: '15m' } }),
      { getOrThrow: (k: string) => (k === 'SUPABASE_URL' ? process.env.SUPABASE_URL : 'local-anon') } as unknown as ConfigService,
      { log: async () => undefined } as unknown as AuditService,
      { validate: async () => undefined } as unknown as BranchValidatorService,
    );
  }, 60000);

  afterAll(async () => {
    await pg?.end();
  });

  it('public registration still works and yields a tenant OWNER (never a platform admin)', async () => {
    registered = await auth.register(
      {
        businessName: `Biz ${RUN}`, ownerName: 'Owner', phone: '0500000000', email, password,
        activity: 'supermarket', branchName: 'Main', city: 'Riyadh',
      } as never,
      '127.0.0.1',
      'jest',
    );
    const claims = decode(registered.access_token);
    expect(claims.roles).toEqual(['owner']);
    expect(claims.role).toBe('owner');
    expect(claims.platform_admin).toBe(false);
    expect(claims.tenant_id).toBeTruthy();

    const [u] = await q('SELECT u.role, u.tenant_id, r.name AS role_name, r.tenant_id AS role_tenant FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE u.email=$1', [email]);
    expect(u.role).toBe('owner');
    expect(u.role_name).toBe('owner');
    expect(u.role_tenant).toBeNull(); // the GLOBAL owner role
    expect(u.tenant_id).toBe(claims.tenant_id);
  });

  it('registration completes the accounting bootstrap (fiscal year + chart) — unaffected by the new triggers', async () => {
    const tenantId = decode(registered.access_token).tenant_id;
    const fy = await q('SELECT year_label FROM fiscal_years WHERE tenant_id=$1', [tenantId]);
    expect(fy.length).toBe(1);
    const accts = await q('SELECT count(*)::int AS n FROM accounts WHERE tenant_id=$1', [tenantId]);
    expect(accts[0].n).toBeGreaterThanOrEqual(8);
  });

  it('a second registration with the same e-mail is refused (409)', async () => {
    await expect(
      auth.register(
        { businessName: 'x', ownerName: 'x', phone: '1', email, password, activity: 'supermarket', branchName: 'b', city: 'c' } as never,
        '127.0.0.1',
        'jest',
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('login issues the same legitimate claims', async () => {
    const res = await auth.login({ email, password, device_name: 'jest' } as never, '127.0.0.1', 'jest');
    const claims = decode(res.access_token);
    expect(claims.roles).toEqual(['owner']);
    expect(claims.platform_admin).toBe(false);
    expect(claims.sub).toBe(registered.user.id);
  });

  it('wrong password and unknown user are rejected exactly as before', async () => {
    await expect(auth.login({ email, password: 'nope-nope', device_name: 'j' } as never, '127.0.0.1', 'j')).rejects.toMatchObject({ status: 401 });
    await expect(auth.login({ email: `x.${email}`, password, device_name: 'j' } as never, '127.0.0.1', 'j')).rejects.toMatchObject({ status: 401 });
  });

  it('refresh rotates the token, keeps the claims consistent with the database, and a reused refresh token is rejected', async () => {
    const first = await auth.login({ email, password, device_name: 'jest' } as never, '127.0.0.1', 'jest');
    const refreshed = await auth.refresh({ refresh_token: first.refresh_token } as never, '127.0.0.1', 'jest');
    const claims = decode(refreshed.access_token);
    expect(claims.roles).toEqual(['owner']);
    expect(claims.platform_admin).toBe(false);
    expect(refreshed.refresh_token).not.toBe(first.refresh_token);
    await expect(auth.refresh({ refresh_token: first.refresh_token } as never, '127.0.0.1', 'jest')).rejects.toMatchObject({ status: 401 });
  });

  it('claims follow the DATABASE at every refresh (not a stale copy): a role removed in the database disappears at the next refresh', async () => {
    const tenantId = decode(registered.access_token).tenant_id;
    const [role] = await q<{ id: string }>("INSERT INTO roles (tenant_id, name, is_system) VALUES ($1,$2,false) RETURNING id", [tenantId, `Temp ${RUN}`]);
    await q('INSERT INTO user_roles (user_id, role_id, is_primary) VALUES ($1,$2,false)', [registered.user.id, role.id]);
    const a = await auth.login({ email, password, device_name: 'jest' } as never, '127.0.0.1', 'jest');
    expect(decode(a.access_token).roles).toEqual(expect.arrayContaining(['owner', `Temp ${RUN}`]));
    await q('DELETE FROM user_roles WHERE role_id=$1', [role.id]);
    const b = await auth.refresh({ refresh_token: a.refresh_token } as never, '127.0.0.1', 'jest');
    expect(decode(b.access_token).roles).toEqual(['owner']);
    await q('DELETE FROM roles WHERE id=$1', [role.id]);
  });

  it('every issued token carries tenant_id and the platform_admin boolean; the legacy `role` mirror is unchanged', async () => {
    const res = await auth.login({ email, password, device_name: 'jest' } as never, '127.0.0.1', 'jest');
    const claims = decode(res.access_token);
    expect(typeof claims.platform_admin).toBe('boolean');
    expect(Object.keys(claims)).toEqual(expect.arrayContaining(['sub', 'email', 'role', 'roles', 'tenant_id', 'session_id', 'platform_admin']));
  });
});
