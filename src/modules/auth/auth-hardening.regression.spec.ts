/**
 * T9 / auth hardening, flag-gated. Real AuthService, TenantGuard, AuthControlService and tables.
 * LOCAL DISPOSABLE DATABASE ONLY (docker loopback; see test/local-db).
 *
 * Flags: AUTH_ENFORCE_TENANT_STATUS, AUTH_TENANT_STATUS_CACHE_TTL_SECONDS,
 * AUTH_REVOKE_SESSIONS_ON_PASSWORD_CHANGE. Every "OFF" test proves today's behaviour is unchanged.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Client as PgClient } from 'pg';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { AuditService } from '../../core/audit/audit.service';
import { BranchValidatorService } from '../../core/security/branch-validator.service';
import { TenantStatusService } from '../../core/security/tenant-status.service';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { AuthControlService } from '../superadmin/services/auth-control.service';
import { AuthService } from './auth.service';

const LOOPBACK = ['127.0.0.1', 'localhost', '::1', '[::1]'];
const SECRET = 'auth-hardening-local-only-secret-0123456789abcdef';
const PASSWORD = 'Passw0rd!1';
jest.setTimeout(60000);
const RUN = `authh-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const FLAGS = [
  'AUTH_ENFORCE_TENANT_STATUS',
  'AUTH_TENANT_STATUS_CACHE_TTL_SECONDS',
  'AUTH_ALLOW_SUSPENDED_LOGIN',
  'AUTH_REVOKE_SESSIONS_ON_PASSWORD_CHANGE',
];

describe('auth hardening (flag-gated) - local database', () => {
  let pg: PgClient;
  let supabase: SupabaseClient;
  let auth: AuthService;
  let control: AuthControlService;
  let statusService: TenantStatusService;
  let guard: TenantGuard;
  const tenants: string[] = [];
  const userIds: string[] = [];
  const q = async (sql: string, p: unknown[] = []) =>
    (await pg.query(sql, p)).rows as any[];
  const email = (k: string) => `${RUN}.${k}@auth.invalid`;
  const setFlags = (f: Record<string, string>) => {
    for (const k of FLAGS) delete process.env[k];
    Object.assign(process.env, f);
  };

  async function makeTenant(status: string) {
    const id = randomUUID();
    tenants.push(id);
    await q('INSERT INTO tenants (id, name, business_type, status) VALUES ($1,$2,$3,$4)', [
      id, `${RUN}-${tenants.length}`, 'retail', status,
    ]);
    return id;
  }
  async function makeUser(key: string, tenantId: string | null, role = 'cashier') {
    const id = randomUUID();
    await q(
      'INSERT INTO users (id, tenant_id, name, email, password_hash, role, is_active) VALUES ($1,$2,$3,$4,$5,$6,true)',
      [id, tenantId, key, email(key), await bcrypt.hash(PASSWORD, 4), role],
    );
    userIds.push(id);
    return id;
  }
  const login = (key: string) =>
    auth.login({ email: email(key), password: PASSWORD, device_name: 'jest' } as never, '127.0.0.1', 'jest');
  const refresh = (t: string) => auth.refresh({ refresh_token: t } as never, '127.0.0.1', 'jest');
  const sessionId = (accessToken: string) =>
    (new JwtService({ secret: SECRET }).decode(accessToken) as any).session_id as string;

  const guardRun = async (user: Record<string, unknown>, url: string, method = 'GET') => {
    const req: any = { user, headers: {}, originalUrl: url, method };
    const c = {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
    return guard.canActivate(c);
  };

  beforeAll(async () => {
    const dbHost = new URL(process.env.DATABASE_URL ?? 'postgres://invalid').hostname;
    const apiHost = new URL(process.env.SUPABASE_URL ?? 'http://invalid').hostname;
    if (!LOOPBACK.includes(dbHost) || !LOOPBACK.includes(apiHost)) {
      throw new Error('auth hardening suite refuses to run: not a loopback DB');
    }
    pg = new PgClient({ connectionString: process.env.DATABASE_URL });
    await pg.connect();
    supabase = createClient(
      process.env.SUPABASE_URL as string,
      process.env.SUPABASE_SERVICE_ROLE_KEY as string,
      { auth: { persistSession: false } },
    );
    auth = new AuthService(
      supabase,
      {} as never,
      new JwtService({ secret: SECRET, signOptions: { expiresIn: '15m' } }),
      {
        getOrThrow: (k: string) => (k === 'SUPABASE_URL' ? process.env.SUPABASE_URL : 'local-anon'),
      } as unknown as ConfigService,
      { log: async () => undefined } as unknown as AuditService,
      { validate: async () => undefined } as unknown as BranchValidatorService,
    );
    control = new AuthControlService(supabase);
    statusService = new TenantStatusService(supabase);
    guard = new TenantGuard(
      { getAllAndOverride: () => false } as unknown as Reflector,
      { validate: async () => undefined } as never,
      { get: async () => ({ enabled: false, mainBranchId: null }), isActiveBranch: async () => true } as never,
      { assertAccess: async () => undefined } as never,
      statusService,
    );
  }, 120000);

  afterEach(() => {
    setFlags({});
    statusService.invalidate();
  });

  afterAll(async () => {
    setFlags({});
    try {
      await q('DELETE FROM refresh_tokens WHERE user_id = ANY($1)', [userIds]);
      await q('DELETE FROM device_sessions WHERE user_id = ANY($1)', [userIds]);
      await q('DELETE FROM users WHERE id = ANY($1)', [userIds]);
      await q('DELETE FROM tenants WHERE id = ANY($1)', [tenants]);
    } finally {
      await pg?.end();
    }
  }, 60000);

  // ------------------------------------------------------------------ item 1
  describe('AUTH_ENFORCE_TENANT_STATUS', () => {
    it('OFF (default): suspended and cancelled tenants log in, refresh and pass the TenantGuard exactly as before', async () => {
      const t = await makeTenant('active');
      const uid = await makeUser('off', t);
      const l = await login('off');
      await q("UPDATE tenants SET status = 'suspended' WHERE id = $1", [t]);
      await expect(refresh(l.refresh_token)).resolves.toBeDefined();
      await q("UPDATE tenants SET status = 'cancelled' WHERE id = $1", [t]);
      await expect(login('off')).resolves.toBeDefined();
      await expect(guardRun({ sub: uid, tenant_id: t, roles: ['cashier'] }, '/invoices')).resolves.toBe(true);
    });

    it('ON: login is refused (403 TENANT_SUSPENDED / TENANT_CANCELLED) only after the password is right', async () => {
      setFlags({ AUTH_ENFORCE_TENANT_STATUS: 'true', AUTH_ALLOW_SUSPENDED_LOGIN: 'false' });
      const ts = await makeTenant('suspended');
      const tc = await makeTenant('cancelled');
      await makeUser('lg-s', ts);
      await makeUser('lg-c', tc);
      await expect(login('lg-s')).rejects.toMatchObject({
        status: 403,
        response: { code: 'TENANT_SUSPENDED', message: expect.stringMatching(/suspended/i) },
      });
      await expect(login('lg-c')).rejects.toMatchObject({
        status: 403,
        response: { code: 'TENANT_CANCELLED' },
      });
      // wrong password: still the generic 401, the tenant status is not disclosed
      await expect(
        auth.login({ email: email('lg-s'), password: 'wrong', device_name: 'j' } as never, '127.0.0.1', 'jest'),
      ).rejects.toMatchObject({ status: 401 });
      // no session was created for the refused login
      const u = await q('SELECT id FROM users WHERE email = $1', [email('lg-s')]);
      expect(await q('SELECT 1 FROM device_sessions WHERE user_id = $1', [u[0].id])).toHaveLength(0);
    });

    it('ON: trial and active tenants and tenant-less platform admins are unaffected', async () => {
      setFlags({ AUTH_ENFORCE_TENANT_STATUS: 'true' });
      const ta = await makeTenant('active');
      const tt = await makeTenant('trial');
      await makeUser('ok-a', ta);
      await makeUser('ok-t', tt);
      await makeUser('ok-p', null, 'superadmin');
      await expect(login('ok-a')).resolves.toBeDefined();
      await expect(login('ok-t')).resolves.toBeDefined();
      const p = await login('ok-p');
      await expect(refresh(p.refresh_token)).resolves.toBeDefined();
    });

    it('ON: refresh is refused (401) after the tenant is suspended, does not burn the refresh token, and works again after reactivation', async () => {
      const t = await makeTenant('active');
      await makeUser('rf', t);
      const l = await login('rf');
      setFlags({ AUTH_ENFORCE_TENANT_STATUS: 'true', AUTH_ALLOW_SUSPENDED_LOGIN: 'false' });
      await q("UPDATE tenants SET status = 'suspended' WHERE id = $1", [t]);
      await expect(refresh(l.refresh_token)).rejects.toMatchObject({
        status: 401,
        response: { code: 'TENANT_SUSPENDED' },
      });
      await q("UPDATE tenants SET status = 'active' WHERE id = $1", [t]);
      await expect(refresh(l.refresh_token)).resolves.toBeDefined();
    });

    it('ON: TenantGuard refuses issued tokens of a suspended/cancelled tenant but keeps billing/subscription/auth routes reachable', async () => {
      setFlags({ AUTH_ENFORCE_TENANT_STATUS: 'true' });
      const ts = await makeTenant('suspended');
      const tc = await makeTenant('cancelled');
      const user = (t: string) => ({ sub: 'x', tenant_id: t, roles: ['owner'] });
      await expect(guardRun(user(ts), '/invoices')).rejects.toMatchObject({
        status: 403,
        response: { code: 'TENANT_SUSPENDED' },
      });
      await expect(guardRun(user(tc), '/api/v1/products?x=1')).rejects.toMatchObject({
        status: 403,
        response: { code: 'TENANT_CANCELLED' },
      });
      for (const url of [
        '/tenant/subscription',
        '/subscriptions/current',
        '/tenant/usage',
        '/tenant/profile',
        '/payments/invoices/abc',
        '/billing/invoices',
        '/plans',
        '/entitlements',
        '/auth/me',
        '/auth/logout',
        '/health',
        '/webhooks/stripe',
      ]) {
        await expect(guardRun(user(ts), url)).resolves.toBe(true);
      }
      // writes to the profile are NOT exempt (GET only)
      await expect(guardRun(user(ts), '/tenant/profile', 'PATCH')).rejects.toMatchObject({ status: 403 });
      // tenant-less platform admin never affected, with or without a tenant header
      await expect(guardRun({ sub: 'p', tenant_id: null, roles: ['superadmin'], platform_admin: true }, '/invoices')).resolves.toBe(true);
    });

    it('ON: a healthy tenant is not blocked; the guard result is cached (no per-request DB round trip) for the TTL, then re-read', async () => {
      setFlags({ AUTH_ENFORCE_TENANT_STATUS: 'true', AUTH_TENANT_STATUS_CACHE_TTL_SECONDS: '1' });
      const t = await makeTenant('active');
      const user = { sub: 'x', tenant_id: t, roles: ['owner'] };
      let reads = 0;
      const counting = new TenantStatusService({
        from: (table: string) => {
          if (table === 'tenants') reads++;
          return supabase.from(table);
        },
      } as never);
      const g = new TenantGuard(
        { getAllAndOverride: () => false } as unknown as Reflector,
        { validate: async () => undefined } as never,
        { get: async () => ({ enabled: false, mainBranchId: null }), isActiveBranch: async () => true } as never,
        { assertAccess: async () => undefined } as never,
        counting,
      );
      const run = () =>
        g.canActivate({
          getHandler: () => undefined,
          getClass: () => undefined,
          switchToHttp: () => ({ getRequest: () => ({ user, headers: {}, originalUrl: '/invoices', method: 'GET' }) }),
        } as unknown as ExecutionContext);
      await run();
      expect(reads).toBe(1);
      await q("UPDATE tenants SET status = 'suspended' WHERE id = $1", [t]);
      await run(); // residual window: still served from cache, no DB read
      await run();
      expect(reads).toBe(1);
      await new Promise((r) => setTimeout(r, 1100));
      await expect(run()).rejects.toMatchObject({ status: 403 });
      expect(reads).toBe(2);
    });

    it('ON: a lookup failure fails open (never locks tenants out because of an outage)', async () => {
      setFlags({ AUTH_ENFORCE_TENANT_STATUS: 'true' });
      const broken = new TenantStatusService({
        from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: new Error('down') }) }) }) }),
      } as never);
      expect(await broken.getBlockedStatus('any')).toBeNull();
    });
  });

  // ------------------------------------------------------------------ AUTH_ALLOW_SUSPENDED_LOGIN
  describe('AUTH_ALLOW_SUSPENDED_LOGIN combinations', () => {
    const user = (t: string) => ({ sub: 'x', tenant_id: t, roles: ['owner'] });

    it('enforce OFF (allow flag irrelevant): suspended and cancelled behave exactly as today', async () => {
      for (const allow of [undefined, 'true', 'false']) {
        setFlags(allow ? { AUTH_ALLOW_SUSPENDED_LOGIN: allow } : {});
        const ts = await makeTenant('suspended');
        const tc = await makeTenant('cancelled');
        const k = `off-${allow}`;
        await makeUser(`${k}-s`, ts);
        await makeUser(`${k}-c`, tc);
        const l = await login(`${k}-s`);
        await expect(refresh(l.refresh_token)).resolves.toBeDefined();
        await expect(login(`${k}-c`)).resolves.toBeDefined();
        await expect(guardRun(user(ts), '/invoices')).resolves.toBe(true);
      }
    });

    it('enforce ON + allow TRUE (and default): suspended logs in/refreshes, reaches billing routes, 403 elsewhere; cancelled refused', async () => {
      const variants: Record<string, string>[] = [
        { AUTH_ENFORCE_TENANT_STATUS: 'true', AUTH_ALLOW_SUSPENDED_LOGIN: 'true' },
        { AUTH_ENFORCE_TENANT_STATUS: 'true' },
      ];
      for (const [i, flags] of variants.entries()) {
        setFlags(flags);
        statusService.invalidate();
        const ts = await makeTenant('suspended');
        const tc = await makeTenant('cancelled');
        const k = `on-t-${i}`;
        await makeUser(`${k}-s`, ts);
        await makeUser(`${k}-c`, tc);
        const l = await login(`${k}-s`);
        const r = await refresh(l.refresh_token);
        expect(r.access_token).toBeDefined();
        await expect(guardRun(user(ts), '/tenant/subscription')).resolves.toBe(true);
        await expect(guardRun(user(ts), '/payments/invoices')).resolves.toBe(true);
        await expect(guardRun(user(ts), '/subscriptions/current')).resolves.toBe(true);
        await expect(guardRun(user(ts), '/invoices')).rejects.toMatchObject({
          status: 403,
          response: { code: 'TENANT_SUSPENDED' },
        });
        await expect(login(`${k}-c`)).rejects.toMatchObject({ status: 403, response: { code: 'TENANT_CANCELLED' } });
        const ta = await makeTenant('active');
        await makeUser(`${k}-x`, ta);
        const lx = await login(`${k}-x`);
        await q("UPDATE tenants SET status = 'cancelled' WHERE id = $1", [ta]);
        await expect(refresh(lx.refresh_token)).rejects.toMatchObject({
          status: 401,
          response: { code: 'TENANT_CANCELLED' },
        });
      }
    });

    it('enforce ON + allow FALSE: suspended and cancelled both refused at login and refresh (as first built)', async () => {
      setFlags({ AUTH_ENFORCE_TENANT_STATUS: 'true', AUTH_ALLOW_SUSPENDED_LOGIN: 'false' });
      const ts = await makeTenant('suspended');
      const ta = await makeTenant('active');
      await makeUser('f-s', ts);
      await makeUser('f-a', ta);
      await expect(login('f-s')).rejects.toMatchObject({ status: 403, response: { code: 'TENANT_SUSPENDED' } });
      const l = await login('f-a');
      await q("UPDATE tenants SET status = 'suspended' WHERE id = $1", [ta]);
      await expect(refresh(l.refresh_token)).rejects.toMatchObject({ status: 401, response: { code: 'TENANT_SUSPENDED' } });
      await expect(guardRun(user(ts), '/invoices')).rejects.toMatchObject({ status: 403 });
      await expect(guardRun(user(ts), '/tenant/subscription')).resolves.toBe(true);
    });
  });

  // ------------------------------------------------------------------ item 2
  describe('AUTH_REVOKE_SESSIONS_ON_PASSWORD_CHANGE', () => {
    it('OFF (default): changing the password revokes nothing (both sessions keep refreshing)', async () => {
      const t = await makeTenant('active');
      const id = await makeUser('pw-off', t);
      const l1 = await login('pw-off');
      const l2 = await login('pw-off');
      await auth.revokeSessionsOnPasswordChange(id, sessionId(l1.access_token));
      await control.resetPassword(id, 'N3w-Passw0rd!');
      await expect(refresh(l1.refresh_token)).resolves.toBeDefined();
      await expect(refresh(l2.refresh_token)).resolves.toBeDefined();
    });

    it('ON, own change with two sessions: the current session survives, the other one is revoked (session + refresh token)', async () => {
      setFlags({ AUTH_REVOKE_SESSIONS_ON_PASSWORD_CHANGE: 'true' });
      const t = await makeTenant('active');
      const id = await makeUser('pw-own', t);
      const current = await login('pw-own');
      const other = await login('pw-own');
      await auth.revokeSessionsOnPasswordChange(id, sessionId(current.access_token));
      await expect(refresh(other.refresh_token)).rejects.toThrow(/revoked|invalid|reuse/i);
      await expect(refresh(current.refresh_token)).resolves.toBeDefined();
      const rows = await q('SELECT id, is_revoked FROM device_sessions WHERE user_id = $1', [id]);
      expect(rows.filter((r) => r.is_revoked)).toHaveLength(1);
    });

    it('ON, no current session (admin reset of someone else): every session of that user is revoked, other users untouched', async () => {
      setFlags({ AUTH_REVOKE_SESSIONS_ON_PASSWORD_CHANGE: 'true' });
      const t = await makeTenant('active');
      const id = await makeUser('pw-adm', t);
      await makeUser('pw-bystander', t);
      const a = await login('pw-adm');
      const b = await login('pw-adm');
      const by = await login('pw-bystander');
      await auth.revokeSessionsOnPasswordChange(id, undefined);
      await expect(refresh(a.refresh_token)).rejects.toThrow();
      await expect(refresh(b.refresh_token)).rejects.toThrow();
      await expect(refresh(by.refresh_token)).resolves.toBeDefined();
    });

    it('ON, platform reset-password (AuthControlService) revokes every session; old password rejected', async () => {
      setFlags({ AUTH_REVOKE_SESSIONS_ON_PASSWORD_CHANGE: 'true' });
      const t = await makeTenant('active');
      const id = await makeUser('pw-sa', t);
      const a = await login('pw-sa');
      const b = await login('pw-sa');
      await control.resetPassword(id, 'N3w-Passw0rd!');
      await expect(refresh(a.refresh_token)).rejects.toThrow();
      await expect(refresh(b.refresh_token)).rejects.toThrow();
      await expect(login('pw-sa')).rejects.toThrow(/invalid/i);
    });
  });
});
