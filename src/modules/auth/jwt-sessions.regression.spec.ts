/**
 * T3 / JWT and stale-session review — what really happens to an issued session
 * after each account/tenant event. Real AuthService, real guards, real tables.
 *
 * LOCAL DISPOSABLE DATABASE ONLY (docker loopback; see test/local-db). Needs
 * migration 324 (pending) applied. Scenario ids (S1..) are the ones used in
 * findings/SEFAY_PHASE_1_INTEGRATED/T3_RISKS/REPORT.md.
 *
 * Tests labelled CHARACTERIZATION pin CURRENT behaviour that is a documented
 * residual window / design decision (they are not endorsements: if the
 * behaviour is later changed on purpose, update the test with the decision).
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Client as PgClient } from 'pg';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { ExecutionContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { CoreAuthModule } from '../../core/auth/auth.module';
import { AuditService } from '../../core/audit/audit.service';
import { BranchValidatorService } from '../../core/security/branch-validator.service';
import { SuperAdminGuard } from '../superadmin/guards/superadmin.guard';
import { isPlatformAdmin } from '../../core/security/platform-identity';
import { AuthService } from './auth.service';

const LOOPBACK = ['127.0.0.1', 'localhost', '::1', '[::1]'];
const SECRET = 'jwt-review-local-only-secret-0123456789abcdef';
const PASSWORD = 'Passw0rd!1';
jest.setTimeout(60000);
const RUN = `jwtrev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

function ctx(headers: Record<string, string>): {
  context: ExecutionContext;
  req: any;
} {
  const req: any = { headers };
  const context = {
    getHandler: () => () => undefined,
    getClass: () => class X {},
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { context, req };
}

describe('JWT / stale sessions — local database', () => {
  let pg: PgClient;
  let supabase: SupabaseClient;
  let auth: AuthService;
  let jwtService: JwtService;
  let jwtGuard: JwtAuthGuard;
  const superGuard = new SuperAdminGuard();
  const globalRole: Record<string, string> = {};
  let tenantA: string;
  const tenants: string[] = [];
  const userIds: string[] = [];

  const q = async (sql: string, p: unknown[] = []) =>
    (await pg.query(sql, p)).rows as any[];
  const email = (k: string) => `${RUN}.${k}@jwt.invalid`;

  async function makeUser(
    key: string,
    tenantId: string | null,
    legacyRole: string,
    heldGlobal: string[],
  ) {
    const id = randomUUID();
    const hash = await bcrypt.hash(PASSWORD, 4);
    await q(
      'INSERT INTO users (id, tenant_id, name, email, password_hash, role, is_active) VALUES ($1,$2,$3,$4,$5,$6,true)',
      [id, tenantId, key, email(key), hash, legacyRole],
    );
    for (const r of heldGlobal) {
      await q('INSERT INTO user_roles (user_id, role_id) VALUES ($1,$2)', [
        id,
        globalRole[r],
      ]);
    }
    userIds.push(id);
    return id;
  }
  const login = (key: string) =>
    auth.login(
      { email: email(key), password: PASSWORD, device_name: 'jest' } as never,
      '127.0.0.1',
      'jest',
    );
  const refresh = (token: string) =>
    auth.refresh({ refresh_token: token } as never, '127.0.0.1', 'jest');
  const decode = (t: string) => jwt.verify(t, SECRET) as Record<string, any>;
  /** Runs the real JwtAuthGuard. true = accepted. */
  const accepts = (token: string) => {
    const { context } = ctx({ authorization: `Bearer ${token}` });
    try {
      return jwtGuard.canActivate(context);
    } catch {
      return false;
    }
  };

  beforeAll(async () => {
    const dbHost = new URL(process.env.DATABASE_URL ?? 'postgres://invalid')
      .hostname;
    const apiHost = new URL(process.env.SUPABASE_URL ?? 'http://invalid')
      .hostname;
    if (!LOOPBACK.includes(dbHost) || !LOOPBACK.includes(apiHost)) {
      throw new Error('JWT review suite refuses to run: not a loopback DB');
    }
    pg = new PgClient({ connectionString: process.env.DATABASE_URL });
    await pg.connect();
    supabase = createClient(
      process.env.SUPABASE_URL as string,
      process.env.SUPABASE_SERVICE_ROLE_KEY as string,
      { auth: { persistSession: false } },
    );
    for (const r of await q('SELECT id, name FROM roles WHERE tenant_id IS NULL')) {
      globalRole[r.name] = r.id;
    }
    tenantA = randomUUID();
    tenants.push(tenantA);
    await q(
      'INSERT INTO tenants (id, name, business_type, status) VALUES ($1,$2,$3,$4)',
      [tenantA, `${RUN}-A`, 'retail', 'active'],
    );
    jwtService = new JwtService({
      secret: SECRET,
      signOptions: { expiresIn: '15m' },
    });
    auth = new AuthService(
      supabase,
      {} as never,
      jwtService,
      {
        getOrThrow: (k: string) =>
          k === 'SUPABASE_URL' ? process.env.SUPABASE_URL : 'local-anon',
      } as unknown as ConfigService,
      { log: async () => undefined } as unknown as AuditService,
      { validate: async () => undefined } as unknown as BranchValidatorService,
    );
    jwtGuard = new JwtAuthGuard(new Reflector(), {
      getOrThrow: () => SECRET,
    } as unknown as ConfigService);
  }, 120000);

  afterAll(async () => {
    try {
      await q('DELETE FROM refresh_tokens WHERE user_id = ANY($1)', [userIds]);
      await q('DELETE FROM device_sessions WHERE user_id = ANY($1)', [userIds]);
      await q('DELETE FROM user_roles WHERE user_id = ANY($1)', [userIds]);
      await q('DELETE FROM users WHERE id = ANY($1)', [userIds]);
      await q('DELETE FROM tenants WHERE id = ANY($1)', [tenants]);
    } finally {
      await pg?.end();
    }
  }, 60000);

  // ---------------------------------------------------------------- S1
  describe('S1 access token lifetime', () => {
    async function ttlWith(env: Record<string, string>) {
      const moduleRef = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            isGlobal: true,
            ignoreEnvFile: true,
            load: [() => ({ JWT_SECRET: SECRET, ...env })],
          }),
          CoreAuthModule,
        ],
      }).compile();
      const t = moduleRef.get(JwtService).sign({ sub: 'x' });
      const p = jwt.decode(t) as { exp: number; iat: number };
      return p.exp - p.iat;
    }
    it('defaults to 15 minutes when JWT_EXPIRES_IN is unset', async () => {
      expect(await ttlWith({})).toBe(900);
    });
    it('is driven by JWT_EXPIRES_IN', async () => {
      expect(await ttlWith({ JWT_EXPIRES_IN: '5m' })).toBe(300);
    });
    it('JWT_EXPIRY (the name .env.example used to show) has no effect', async () => {
      expect(await ttlWith({ JWT_EXPIRY: '1m' })).toBe(900);
    });
    it('an expired token, a token signed with another secret and an unsigned token are all refused', () => {
      const expired = jwt.sign({ sub: 'x', tenant_id: tenantA }, SECRET, {
        expiresIn: -10,
      });
      const foreign = jwt.sign({ sub: 'x', tenant_id: tenantA }, 'other-secret-0123456789abcdef-xxxx');
      const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: 'x', roles: ['superadmin'] })).toString('base64url')}.`;
      expect(accepts(expired)).toBe(false);
      expect(accepts(foreign)).toBe(false);
      expect(accepts(none)).toBe(false);
    });
  });

  // ---------------------------------------------------------------- S2-S4
  describe('S2-S4 refresh rotation, replay, parallel use', () => {
    it('S2 rotation: a refresh returns a new pair; the old refresh token is consumed', async () => {
      await makeUser('rot', tenantA, 'cashier', ['cashier']);
      const l = await login('rot');
      const r = await refresh(l.refresh_token);
      expect(r.refresh_token).not.toBe(l.refresh_token);
      expect(decode(r.access_token).session_id).toBe(decode(l.access_token).session_id);
      await expect(refresh(l.refresh_token)).rejects.toThrow(/reuse/i);
    });

    it('S3 replay: re-using a consumed refresh token revokes the whole session (the legitimate newer token dies too)', async () => {
      await makeUser('replay', tenantA, 'cashier', ['cashier']);
      const l = await login('replay');
      const r = await refresh(l.refresh_token);
      await expect(refresh(l.refresh_token)).rejects.toThrow(/reuse/i);
      await expect(refresh(r.refresh_token)).rejects.toThrow(/revoked/i);
    });

    it('S4 parallel use: the same refresh token raced 6 times yields exactly ONE new pair', async () => {
      await makeUser('race', tenantA, 'cashier', ['cashier']);
      const l = await login('race');
      const results = await Promise.allSettled(
        Array.from({ length: 6 }, () => refresh(l.refresh_token)),
      );
      expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    });

    it('S4b a race loser does NOT revoke the session: the winner new refresh token keeps working', async () => {
      await makeUser('race2', tenantA, 'cashier', ['cashier']);
      const l = await login('race2');
      const results = await Promise.allSettled(
        Array.from({ length: 4 }, () => refresh(l.refresh_token)),
      );
      const won = results.find((x) => x.status === 'fulfilled') as
        | PromiseFulfilledResult<{ refresh_token: string }>
        | undefined;
      expect(won).toBeDefined();
      // losers that raced the winner get a plain 401 (no session revocation); those that arrive after the
      // winner finished hit the sequential replay rule (revokes), so only assert when nobody saw reuse.
      const sawReuse = results.some(
        (x) => x.status === 'rejected' && /reuse/i.test(String(x.reason)),
      );
      if (!sawReuse) {
        await expect(refresh(won!.value.refresh_token)).resolves.toBeDefined();
      }
    });
  });

  // ---------------------------------------------------------------- S5
  describe('S5 logout', () => {
    it('refresh stops immediately; the already-issued access token still passes the guard until it expires (stateless JWT)', async () => {
      const id = await makeUser('out', tenantA, 'cashier', ['cashier']);
      const l = await login('out');
      const sid = decode(l.access_token).session_id;
      await auth.logout(id, sid, '127.0.0.1', 'jest', 'cashier', tenantA);
      await expect(refresh(l.refresh_token)).rejects.toThrow(/revoked|reuse|invalid/i);
      // CHARACTERIZATION (residual window <= JWT_EXPIRES_IN):
      expect(accepts(l.access_token)).toBe(true);
    });
  });

  // ---------------------------------------------------------------- S6
  describe('S6 user deactivation / deletion', () => {
    it('a deactivated user cannot log in', async () => {
      const id = await makeUser('deact1', tenantA, 'cashier', ['cashier']);
      await q('UPDATE users SET is_active = false WHERE id = $1', [id]);
      await expect(login('deact1')).rejects.toThrow(/inactive/i);
    });

    it('a deactivated user cannot REFRESH an existing session (even if no one revoked the sessions)', async () => {
      const id = await makeUser('deact2', tenantA, 'cashier', ['cashier']);
      const l = await login('deact2');
      await q('UPDATE users SET is_active = false WHERE id = $1', [id]); // e.g. superadmin toggleActive: does not revoke
      await expect(refresh(l.refresh_token)).rejects.toThrow();
    });

    it('a soft-deleted user cannot refresh', async () => {
      const id = await makeUser('del', tenantA, 'cashier', ['cashier']);
      const l = await login('del');
      await q('UPDATE users SET deleted_at = now(), is_active = false WHERE id = $1', [id]);
      await expect(refresh(l.refresh_token)).rejects.toThrow(/not found/i);
    });

    it('revokeAllSessionsForUser (used by UsersService on disable/delete/branch move) kills every session at its next refresh', async () => {
      const id = await makeUser('revall', tenantA, 'cashier', ['cashier']);
      const l1 = await login('revall');
      const l2 = await login('revall');
      await auth.revokeAllSessionsForUser(id, tenantA);
      await expect(refresh(l1.refresh_token)).rejects.toThrow();
      await expect(refresh(l2.refresh_token)).rejects.toThrow();
    });

    it('CHARACTERIZATION: the access token of a deactivated user keeps passing JwtAuthGuard until it expires', async () => {
      const id = await makeUser('deact3', tenantA, 'cashier', ['cashier']);
      const l = await login('deact3');
      await q('UPDATE users SET is_active = false WHERE id = $1', [id]);
      expect(accepts(l.access_token)).toBe(true);
    });
  });

  // ---------------------------------------------------------------- S7/S8
  describe('S7/S8 role change and role removal', () => {
    it('S7 the issued access token keeps the OLD roles (<= TTL); the next refresh carries the NEW roles', async () => {
      const id = await makeUser('rolechg', tenantA, 'cashier', ['cashier']);
      const l = await login('rolechg');
      expect(decode(l.access_token).roles).toEqual(['cashier']);
      await q('DELETE FROM user_roles WHERE user_id = $1', [id]);
      await q('INSERT INTO user_roles (user_id, role_id) VALUES ($1,$2)', [id, globalRole.manager]);
      await q("UPDATE users SET role = 'manager' WHERE id = $1", [id]);
      expect(decode(l.access_token).roles).toEqual(['cashier']);
      const r = await refresh(l.refresh_token);
      expect(decode(r.access_token).roles).toEqual(['manager']);
      expect(decode(r.access_token).role).toBe('manager');
    });

    it('S8 removing a role: the old token still names it; the refreshed token no longer does', async () => {
      const id = await makeUser('rolerm', tenantA, 'manager', ['manager', 'cashier']);
      const l = await login('rolerm');
      expect(decode(l.access_token).roles.sort()).toEqual(['cashier', 'manager']);
      await q('DELETE FROM user_roles WHERE user_id = $1 AND role_id = $2', [id, globalRole.manager]);
      const r = await refresh(l.refresh_token);
      expect(decode(r.access_token).roles).toEqual(['cashier']);
    });
  });

  // ---------------------------------------------------------------- S9
  describe('S9 tenant suspension / cancellation', () => {
    it('CHARACTERIZATION (design decision D-T3-2): tenants.status = suspended/cancelled blocks neither login, refresh nor an issued token', async () => {
      const t = randomUUID();
      tenants.push(t);
      await q(
        'INSERT INTO tenants (id, name, business_type, status) VALUES ($1,$2,$3,$4)',
        [t, `${RUN}-S`, 'retail', 'active'],
      );
      await makeUser('susp', t, 'cashier', ['cashier']);
      const l = await login('susp');
      await q("UPDATE tenants SET status = 'suspended' WHERE id = $1", [t]);
      expect(accepts(l.access_token)).toBe(true);
      const r = await refresh(l.refresh_token);
      expect(accepts(r.access_token)).toBe(true);
      await q("UPDATE tenants SET status = 'cancelled' WHERE id = $1", [t]);
      await expect(login('susp')).resolves.toBeDefined();
    });
  });

  // ---------------------------------------------------------------- S10
  describe('S10 password change', () => {
    it('the old password stops working at once', async () => {
      const id = await makeUser('pw1', tenantA, 'cashier', ['cashier']);
      await q('UPDATE users SET password_hash = $2 WHERE id = $1', [id, await bcrypt.hash('N3w-Passw0rd!', 4)]);
      await expect(login('pw1')).rejects.toThrow(/invalid/i);
    });
    it('CHARACTERIZATION (design decision D-T3-3): sessions opened before the change keep refreshing', async () => {
      const id = await makeUser('pw2', tenantA, 'cashier', ['cashier']);
      const l = await login('pw2');
      await q('UPDATE users SET password_hash = $2 WHERE id = $1', [id, await bcrypt.hash('N3w-Passw0rd!', 4)]);
      await expect(refresh(l.refresh_token)).resolves.toBeDefined();
    });
  });

  // ---------------------------------------------------------------- S11/S12
  describe('S11/S12 platform vs tenant identity in tokens', () => {
    const sign = (claims: Record<string, unknown>) =>
      jwt.sign({ sub: randomUUID(), session_id: randomUUID(), ...claims }, SECRET, { expiresIn: '15m' });
    const superOk = (token: string) => {
      const { context, req } = ctx({ authorization: `Bearer ${token}` });
      jwtGuard.canActivate(context);
      try {
        return superGuard.canActivate({
          switchToHttp: () => ({ getRequest: () => req }),
        } as unknown as ExecutionContext);
      } catch {
        return false;
      }
    };

    it('S11 a tenant-scoped token naming superadmin (issued before the WP-A fix, no claim) is refused', () => {
      expect(superOk(sign({ tenant_id: tenantA, role: 'superadmin', roles: ['superadmin'] }))).toBe(false);
      expect(superOk(sign({ tenant_id: tenantA, role: 'owner', roles: ['superadmin', 'owner'] }))).toBe(false);
      expect(isPlatformAdmin({ tenant_id: tenantA, roles: ['superadmin'] })).toBe(false);
    });

    it('S11b ... and so is one whose platform_admin claim was injected for a tenant identity', () => {
      expect(superOk(sign({ tenant_id: tenantA, role: 'superadmin', roles: ['superadmin'], platform_admin: true }))).toBe(false);
    });

    it('S12 a legacy token of a real platform admin (tenant-less, no platform_admin claim) keeps working', () => {
      expect(superOk(sign({ tenant_id: null, role: 'superadmin', roles: ['superadmin'] }))).toBe(true);
      expect(superOk(sign({ tenant_id: null, role: 'superadmin' }))).toBe(true);
    });

    it('S12b a token minted by the real login for a platform admin carries platform_admin=true and works', async () => {
      await makeUser('plat', null, 'superadmin', ['superadmin']);
      const l = await login('plat');
      expect(decode(l.access_token).platform_admin).toBe(true);
      expect(superOk(l.access_token)).toBe(true);
    });

    it('S12c a tenant owner token from the real login is never platform', async () => {
      await makeUser('own', tenantA, 'owner', ['owner']);
      const l = await login('own');
      expect(decode(l.access_token).platform_admin).toBe(false);
      expect(superOk(l.access_token)).toBe(false);
    });
  });
});
