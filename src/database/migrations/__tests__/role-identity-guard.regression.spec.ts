/**
 * WP-A / R-01 — end-to-end regression suite for platform-vs-tenant identity.
 *
 * LOCAL DISPOSABLE DATABASE ONLY. Runs through `npm run test:integration:local`
 * (docker Postgres + PostgREST on loopback; see test/local-db). The suite
 * refuses to start unless every connection it uses is a loopback address, in
 * addition to the project-wide guard in test/support/db-safety.ts.
 *
 * Requires migration 324 (src/database/migrations_pending/) to be applied to
 * the local database (`node test/local-db/apply.js --with-pending`).
 *
 * What is exercised (real code, real database, no mocks of the logic under test):
 *   - the database triggers of migration 324 (direct SQL = bypass of every API check)
 *   - the real AuthService.login / refresh (token claims)
 *   - the real PermissionsService (identity-based resolution)
 *   - the real controllers + guards + services over HTTP (supertest)
 *   - pre-existing offending roles (created with the trigger disabled, locally only)
 *   - old sessions / pre-fix token shapes
 *   - parallel and conflicting requests
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Client as PgClient } from 'pg';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  Controller,
  Get,
  INestApplication,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { SUPABASE_CLIENT } from '../../../shared/supabase/supabase.module';
import { JwtAuthGuard } from '../../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../../core/tenant/tenant.guard';
import { GetTenant } from '../../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../../core/tenant/tenant.context';
import { PermissionGuard } from '../../../core/permissions/permission.guard';
import { PermissionsService } from '../../../core/permissions/permissions.service';
import { RedisCacheService } from '../../../core/cache/redis-cache.service';
import { AuditService } from '../../../core/audit/audit.service';
import { BillingService } from '../../../core/billing/billing.service';
import { BranchValidatorService } from '../../../core/security/branch-validator.service';
import { TenantIsolationService } from '../../../core/security/tenant-isolation.service';
import { EntitlementsService } from '../../../core/security/entitlements.service';
import { normalizeRoleName } from '../../../core/security/platform-identity';
import { SuperAdminGuard } from '../../../modules/superadmin/guards/superadmin.guard';
import { AccessControlController } from '../../../modules/access-control/access-control.controller';
import { AccessControlService } from '../../../modules/access-control/access-control.service';
import { AccessControlRepository } from '../../../modules/access-control/access-control.repository';
import { AccessControlAdminGuard } from '../../../modules/access-control/guards/access-control-admin.guard';
import { UsersController } from '../../../modules/users/users.controller';
import { UsersService } from '../../../modules/users/users.service';
import { UsersRepository } from '../../../modules/users/users.repository';
import { AuthService } from '../../../modules/auth/auth.service';

const ZWSP = String.fromCharCode(0x200b); // zero-width space
const ZWJ = String.fromCharCode(0x200d); // zero-width joiner
const SHY = String.fromCharCode(0xad); // soft hyphen

const LOOPBACK = ['127.0.0.1', 'localhost', '::1', '[::1]'];
const SECRET = 'r01-local-only-jwt-secret-0123456789abcdef';
const PASSWORD = 'Passw0rd!1';
const RUN = `r01-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

@Controller('probe')
@UseGuards(JwtAuthGuard, TenantGuard, SuperAdminGuard)
class PlatformProbeController {
  @Get('platform')
  platform(@GetTenant() t: TenantContext) {
    return { ok: true, tenant: t.tenantId };
  }
}

const memoryCache = {
  get: async () => null,
  set: async () => undefined,
  del: async () => undefined,
};

describe('R-01 identity separation — local database regression', () => {
  let pg: PgClient;
  let supabase: SupabaseClient;
  let app: INestApplication;
  let authService: AuthService;
  let jwtService: JwtService;
  let permissions: PermissionsService;

  const globalRole: Record<string, string> = {};
  let tenantA: string;
  let tenantB: string;
  const u: Record<string, string> = {}; // user ids
  const email = (k: string) => `${RUN}.${k}@r01.invalid`;
  const createdRoleIds: string[] = [];

  async function q<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await pg.query(sql, params)).rows as T[];
  }

  async function withOffenderTriggerDisabled<T>(
    fn: () => Promise<T>,
  ): Promise<T> {
    // LOCAL ONLY: simulates a row that exists from before migration 324.
    await pg.query(
      'ALTER TABLE roles DISABLE TRIGGER trg_roles_reserved_name_guard',
    );
    try {
      return await fn();
    } finally {
      await pg.query(
        'ALTER TABLE roles ENABLE TRIGGER trg_roles_reserved_name_guard',
      );
    }
  }

  async function makeTenant(label: string): Promise<string> {
    const id = randomUUID();
    await q(
      'INSERT INTO tenants (id, name, business_type, status) VALUES ($1,$2,$3,$4)',
      [id, `${RUN}-${label}`, 'retail', 'active'],
    );
    return id;
  }

  async function makeUser(
    key: string,
    tenantId: string | null,
    role: string,
    globalRoleName?: string,
  ) {
    const id = randomUUID();
    u[key] = id;
    const hash = await bcrypt.hash(PASSWORD, 4);
    await q(
      'INSERT INTO users (id, tenant_id, name, email, password_hash, role, is_active) VALUES ($1,$2,$3,$4,$5,$6,true)',
      [id, tenantId, key, email(key), hash, role],
    );
    if (globalRoleName) {
      await q(
        'INSERT INTO user_roles (user_id, role_id, is_primary) VALUES ($1,$2,true)',
        [id, globalRole[globalRoleName]],
      );
    }
    return id;
  }

  async function login(key: string) {
    return authService.login(
      { email: email(key), password: PASSWORD, device_name: 'jest' } as never,
      '127.0.0.1',
      'jest',
    );
  }
  const decode = (token: string) =>
    jwt.verify(token, SECRET) as Record<string, any>;
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    // ---- isolation proof: refuse to run against anything but loopback ----
    const dbHost = new URL(process.env.DATABASE_URL ?? 'postgres://invalid')
      .hostname;
    const apiHost = new URL(process.env.SUPABASE_URL ?? 'http://invalid')
      .hostname;
    if (!LOOPBACK.includes(dbHost) || !LOOPBACK.includes(apiHost)) {
      throw new Error(
        `R-01 suite refuses to run: DATABASE_URL host "${dbHost}" / SUPABASE_URL host "${apiHost}" is not loopback`,
      );
    }

    pg = new PgClient({ connectionString: process.env.DATABASE_URL });
    await pg.connect();
    supabase = createClient(
      process.env.SUPABASE_URL as string,
      process.env.SUPABASE_SERVICE_ROLE_KEY as string,
      {
        auth: { persistSession: false },
      },
    );

    for (const r of await q<{ id: string; name: string }>(
      'SELECT id, name FROM roles WHERE tenant_id IS NULL',
    )) {
      globalRole[r.name] = r.id;
    }
    for (const n of ['superadmin', 'owner', 'manager', 'cashier']) {
      if (!globalRole[n])
        throw new Error(
          `global role ${n} missing — apply migrations to the local DB`,
        );
    }
    const trig = await q(
      "SELECT 1 FROM pg_trigger WHERE tgname = 'trg_roles_reserved_name_guard'",
    );
    if (trig.length === 0)
      throw new Error(
        'migration 324 is not applied to the local DB (node test/local-db/apply.js --with-pending)',
      );

    // legacy-path permission fixtures for the HTTP checks (local only)
    for (const [name, action] of [
      ['users.manage', 'manage'],
      ['users.view', 'view'],
    ]) {
      await q(
        'INSERT INTO permissions (name, resource, action) SELECT $1, $2, $3 WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = $1)',
        [name, 'users', action],
      );
    }
    await q(
      "DELETE FROM role_permissions WHERE role IN ('manager','cashier') AND permission_key IN ('users.manage','users.view')",
    );
    await q(
      "INSERT INTO role_permissions (role, permission_key, is_granted) VALUES ('manager','users.manage',true),('manager','users.view',true),('cashier','users.view',true)",
    );

    tenantA = await makeTenant('A');
    tenantB = await makeTenant('B');
    await makeUser('ownerA', tenantA, 'owner', 'owner');
    await makeUser('managerA', tenantA, 'manager', 'manager');
    await makeUser('cashierA', tenantA, 'cashier', 'cashier');
    await makeUser('targetA', tenantA, 'cashier', 'cashier'); // someone to assign roles to
    await makeUser('ownerB', tenantB, 'owner', 'owner');
    await makeUser('platform', null, 'superadmin', 'superadmin');

    jwtService = new JwtService({
      secret: SECRET,
      signOptions: { expiresIn: '15m' },
    });
    authService = new AuthService(
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
    permissions = new PermissionsService(
      supabase,
      memoryCache as unknown as RedisCacheService,
    );

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ JWT_SECRET: SECRET })],
        }),
      ],
      controllers: [
        AccessControlController,
        UsersController,
        PlatformProbeController,
      ],
      providers: [
        { provide: SUPABASE_CLIENT, useValue: supabase },
        JwtAuthGuard,
        TenantGuard,
        PermissionGuard,
        AccessControlAdminGuard,
        SuperAdminGuard,
        AccessControlService,
        AccessControlRepository,
        UsersService,
        UsersRepository,
        PermissionsService,
        { provide: RedisCacheService, useValue: memoryCache },
        { provide: AuditService, useValue: { log: async () => undefined } },
        {
          provide: BillingService,
          useValue: { checkUserLimit: async () => undefined },
        },
        { provide: AuthService, useValue: authService },
        {
          provide: BranchValidatorService,
          useValue: { validate: async () => undefined },
        },
        {
          provide: TenantIsolationService,
          useValue: {
            get: async () => ({ enabled: false, mainBranchId: null }),
            isActiveBranch: async () => true,
          },
        },
        {
          provide: EntitlementsService,
          useValue: { assertAccess: async () => undefined },
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  }, 120000);

  afterAll(async () => {
    try {
      await pg.query(
        'ALTER TABLE roles ENABLE TRIGGER trg_roles_reserved_name_guard',
      );
      await q(
        "DELETE FROM role_permissions WHERE role IN ('manager','cashier') AND permission_key IN ('users.manage','users.view')",
      );
      if (createdRoleIds.length)
        await q('DELETE FROM user_roles WHERE role_id = ANY($1)', [
          createdRoleIds,
        ]);
      await q('DELETE FROM tenant_role_permissions WHERE tenant_id = ANY($1)', [
        [tenantA, tenantB],
      ]);
      await q('DELETE FROM roles WHERE tenant_id = ANY($1)', [
        [tenantA, tenantB],
      ]);
      await q('DELETE FROM users WHERE email LIKE $1', [`${RUN}.%`]);
      await q('DELETE FROM tenants WHERE id = ANY($1)', [[tenantA, tenantB]]);
    } finally {
      await app?.close();
      await pg?.end();
    }
  }, 60000);

  // =====================================================================
  describe('database triggers (direct SQL bypasses every API check)', () => {
    const RESERVED_VARIANTS = [
      'superadmin',
      'SuperAdmin',
      ' super admin ',
      'super_admin',
      'super-admin',
      'ｓｕｐｅｒａｄｍｉｎ',
      `super${ZWSP}admin`,
      'sυperadmin',
      'ѕuperadmin',
      'owner',
      'OWNER',
      'оwner',
      'manager',
      'Cashier',
      'worker',
      'inventory clerk',
      'none',
      'admin',
      'platform',
    ];

    it.each(RESERVED_VARIANTS)(
      'rejects a tenant role named %j (SQLSTATE 23514)',
      async (name) => {
        await expect(
          pg.query(
            'INSERT INTO roles (tenant_id, name, is_system) VALUES ($1,$2,false)',
            [tenantA, name],
          ),
        ).rejects.toMatchObject({ code: '23514' });
      },
    );

    it('rejects the same names through PostgREST with a service-role session (every writer is covered)', async () => {
      const { error } = await supabase
        .from('roles')
        .insert({ tenant_id: tenantA, name: 'superadmin', is_system: false });
      expect(error).toBeTruthy();
      expect(error?.code).toBe('23514');
    });

    it('rejects a name that normalises to nothing', async () => {
      await expect(
        pg.query(
          'INSERT INTO roles (tenant_id, name, is_system) VALUES ($1,$2,false)',
          [tenantA, `${ZWSP}${ZWJ}`],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('a rename of a legitimate custom role INTO a reserved name is rejected; a legitimate rename works', async () => {
      const [r] = await q<{ id: string }>(
        "INSERT INTO roles (tenant_id, name, is_system) VALUES ($1,'Rename Me',false) RETURNING id",
        [tenantA],
      );
      createdRoleIds.push(r.id);
      await expect(
        pg.query("UPDATE roles SET name='owner' WHERE id=$1", [r.id]),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        pg.query("UPDATE roles SET name='Renamed Role' WHERE id=$1", [r.id]),
      ).resolves.toBeDefined();
    });

    it('legitimate custom role names keep working (including Arabic and names that merely contain a reserved word)', async () => {
      for (const name of [
        'Supervisor',
        'Shift Lead',
        'Cashier Trainee',
        'Owners Club',
        'مشرف الوردية',
      ]) {
        const [r] = await q<{ id: string }>(
          'INSERT INTO roles (tenant_id, name, is_system) VALUES ($1,$2,false) RETURNING id',
          [tenantA, `${name} ${RUN}`],
        );
        createdRoleIds.push(r.id);
      }
    });

    it('the TypeScript and SQL normalisers agree on the shared vectors (no drift between layers)', async () => {
      const vectors = [
        'SuperAdmin',
        ' super admin ',
        'super_admin',
        'ｓｕｐｅｒａｄｍｉｎ',
        `super${ZWSP}admin`,
        'sυperadmin',
        'ѕuperadmin',
        'оwner',
        'Inventory Clerk',
        'Cashier',
        'Shift Lead',
        'مشرف',
      ];
      for (const v of vectors) {
        const [row] = await q<{ n: string }>(
          'SELECT fn_normalize_role_name($1) AS n',
          [v],
        );
        expect(row.n).toBe(normalizeRoleName(v));
      }
    });

    it('user_roles: the platform role cannot be assigned to a tenant user', async () => {
      await expect(
        pg.query(
          'INSERT INTO user_roles (user_id, role_id, is_primary) VALUES ($1,$2,false)',
          [u.targetA, globalRole.superadmin],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      const { error } = await supabase.from('user_roles').insert({
        user_id: u.targetA,
        role_id: globalRole.superadmin,
        is_primary: false,
      });
      expect(error?.code).toBe('23514');
    });

    it('user_roles: a tenant role cannot be assigned across tenants or to a tenant-less user', async () => {
      const [r] = await q<{ id: string }>(
        'INSERT INTO roles (tenant_id, name, is_system) VALUES ($1,$2,false) RETURNING id',
        [tenantB, `B-Only ${RUN}`],
      );
      createdRoleIds.push(r.id);
      await expect(
        pg.query(
          'INSERT INTO user_roles (user_id, role_id, is_primary) VALUES ($1,$2,false)',
          [u.targetA, r.id],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        pg.query(
          'INSERT INTO user_roles (user_id, role_id, is_primary) VALUES ($1,$2,false)',
          [u.platform, r.id],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        pg.query(
          'INSERT INTO user_roles (user_id, role_id, is_primary) VALUES ($1,$2,false)',
          [u.ownerB, r.id],
        ),
      ).resolves.toBeDefined();
    });

    it('users: a tenant user cannot take the superadmin role or lose its tenant (conversion to platform user)', async () => {
      await expect(
        pg.query("UPDATE users SET role='superadmin' WHERE id=$1", [u.targetA]),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        pg.query('UPDATE users SET tenant_id=NULL WHERE id=$1', [u.targetA]),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        pg.query(
          "INSERT INTO users (tenant_id, name, email, password_hash, role) VALUES ($1,'x',$2,'x','superadmin')",
          [tenantA, email('forbidden')],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      // ordinary updates of the same row still work
      await expect(
        pg.query("UPDATE users SET name='Target A' WHERE id=$1", [u.targetA]),
      ).resolves.toBeDefined();
    });

    it('the genuine platform user keeps its identity (tenant-less + global superadmin role)', async () => {
      const rows = await q(
        'SELECT 1 FROM user_roles WHERE user_id=$1 AND role_id=$2',
        [u.platform, globalRole.superadmin],
      );
      expect(rows.length).toBe(1);
      await expect(
        pg.query("UPDATE users SET name='Platform' WHERE id=$1", [u.platform]),
      ).resolves.toBeDefined();
    });
  });

  // =====================================================================
  describe('real AuthService tokens', () => {
    it('legitimate owner / manager / cashier keep their roles and are never platform admins', async () => {
      for (const [key, role] of [
        ['ownerA', 'owner'],
        ['managerA', 'manager'],
        ['cashierA', 'cashier'],
      ] as const) {
        const res = await login(key);
        const claims = decode(res.access_token);
        expect(claims.roles).toEqual([role]);
        expect(claims.platform_admin).toBe(false);
        expect(claims.tenant_id).toBe(tenantA);
      }
    });

    it('the genuine platform admin keeps platform identity', async () => {
      const claims = decode((await login('platform')).access_token);
      expect(claims.platform_admin).toBe(true);
      expect(claims.roles).toEqual(['superadmin']);
      expect(claims.tenant_id).toBeNull();
    });

    it('a PRE-EXISTING look-alike (created before the guard) grants nothing: not in roles[], never platform', async () => {
      const offenderId = await withOffenderTriggerDisabled(async () => {
        const [r] = await q<{ id: string }>(
          "INSERT INTO roles (tenant_id, name, is_system) VALUES ($1,'superadmin',false) RETURNING id",
          [tenantA],
        );
        const [o] = await q<{ id: string }>(
          "INSERT INTO roles (tenant_id, name, is_system) VALUES ($1,'owner',false) RETURNING id",
          [tenantA],
        );
        createdRoleIds.push(r.id, o.id);
        await q(
          'INSERT INTO user_roles (user_id, role_id, is_primary) VALUES ($1,$2,false),($1,$3,false)',
          [u.cashierA, r.id, o.id],
        );
        return r.id;
      });
      expect(offenderId).toBeTruthy();

      const claims = decode((await login('cashierA')).access_token);
      expect(claims.roles).toEqual(['cashier']);
      expect(claims.roles).not.toContain('superadmin');
      expect(claims.roles).not.toContain('owner');
      expect(claims.platform_admin).toBe(false);

      // and the audit view lists them for the owner/DBA review
      const v = await q<{ violation: string; role_name: string }>(
        "SELECT violation, role_name FROM v_role_identity_violations WHERE tenant_id = $1 AND violation = 'tenant_role_reserved_name'",
        [tenantA],
      );
      expect(v.map((x) => x.role_name).sort()).toEqual(['owner', 'superadmin']);
      expect(
        (
          await q(
            'SELECT 1 FROM v_role_identity_violations WHERE tenant_id = $1',
            [tenantB],
          )
        ).length,
      ).toBe(0);
    });

    it('a tenant role named "manager" (look-alike) does not inherit the system manager grants through the real PermissionsService', async () => {
      const fake = await withOffenderTriggerDisabled(async () => {
        const [r] = await q<{ id: string }>(
          "INSERT INTO roles (tenant_id, name, is_system) VALUES ($1,'manager',false) RETURNING id",
          [tenantA],
        );
        createdRoleIds.push(r.id);
        await q(
          'INSERT INTO user_roles (user_id, role_id, is_primary) VALUES ($1,$2,false)',
          [u.targetA, r.id],
        );
        return r.id;
      });
      expect(fake).toBeTruthy();
      expect(
        await permissions.hasPermissionForUser(
          u.targetA,
          'users.manage',
          tenantA,
        ),
      ).toBe(false);
      // the genuine manager still has it
      expect(
        await permissions.hasPermissionForUser(
          u.managerA,
          'users.manage',
          tenantA,
        ),
      ).toBe(true);
    });

    it('OLD SESSIONS: refresh re-reads roles — a session opened before the look-alike was assigned loses nothing legitimate and gains nothing', async () => {
      const before = await login('managerA');
      expect(decode(before.access_token).roles).toEqual(['manager']);
      await withOffenderTriggerDisabled(async () => {
        const [r] = await q<{ id: string }>(
          "INSERT INTO roles (tenant_id, name, is_system) VALUES ($1,'SuperAdmin',false) RETURNING id",
          [tenantA],
        );
        createdRoleIds.push(r.id);
        await q(
          'INSERT INTO user_roles (user_id, role_id, is_primary) VALUES ($1,$2,false)',
          [u.managerA, r.id],
        );
      });
      const refreshed = await authService.refresh(
        { refresh_token: before.refresh_token } as never,
        '127.0.0.1',
        'jest',
      );
      const claims = decode(refreshed.access_token);
      expect(claims.roles).toEqual(['manager']);
      expect(claims.platform_admin).toBe(false);
    });
  });

  // =====================================================================
  describe('direct API calls (no UI) — real controllers, guards and services', () => {
    let ownerToken: string;
    let managerToken: string;
    let platformToken: string;
    let forgedOldShape: string;

    beforeAll(async () => {
      ownerToken = (await login('ownerA')).access_token;
      managerToken = (await login('managerA')).access_token;
      platformToken = (await login('platform')).access_token;
      // exactly what a pre-fix token of a tenant owner who minted a "superadmin" role would carry
      forgedOldShape = jwt.sign(
        {
          sub: u.ownerA,
          email: email('ownerA'),
          role: 'owner',
          roles: ['owner', 'superadmin'],
          tenant_id: tenantA,
          session_id: randomUUID(),
        },
        SECRET,
        { expiresIn: '15m' },
      );
    });

    it('401 without a token', async () => {
      await http().get('/access-control/roles').expect(401);
      await http()
        .post('/access-control/roles')
        .send({ name: 'x' })
        .expect(401);
    });

    it('owner cannot create a reserved-name role over HTTP (and nothing is written)', async () => {
      for (const name of [
        'superadmin',
        'SuperAdmin',
        ' owner ',
        'manager',
        'ѕuperadmin',
      ]) {
        const res = await http()
          .post('/access-control/roles')
          .set(bearer(ownerToken))
          .send({ name });
        expect(res.status).toBe(400);
        expect(res.body.reasonCode).toBe('reserved_role_name');
      }
      const rows = await q(
        "SELECT 1 FROM roles WHERE tenant_id=$1 AND lower(name) IN ('superadmin','suprеadmin') AND id <> ALL($2)",
        [tenantA, createdRoleIds],
      );
      expect(rows.length).toBe(0);
    });

    it('owner can still administer legitimate custom roles (create, list, duplicate → 409)', async () => {
      const name = `Supervisor HTTP ${RUN}`;
      const ok = await http()
        .post('/access-control/roles')
        .set(bearer(ownerToken))
        .send({ name });
      expect(ok.status).toBe(201);
      createdRoleIds.push(ok.body.id);
      await http()
        .post('/access-control/roles')
        .set(bearer(ownerToken))
        .send({ name })
        .expect(409);
      const list = await http()
        .get('/access-control/roles')
        .set(bearer(ownerToken))
        .expect(200);
      expect(list.body.map((r: { name: string }) => r.name)).toContain(name);
      // the global platform role is not offered to a tenant
      expect(
        list.body.find(
          (r: { name: string; is_system: boolean }) =>
            r.name === 'superadmin' && r.is_system,
        ),
      ).toBeUndefined();
    });

    it('a manager (users.manage) cannot reach role administration', async () => {
      await http()
        .post('/access-control/roles')
        .set(bearer(managerToken))
        .send({ name: 'Anything Else' })
        .expect(403);
    });

    it('a manager cannot promote anyone (or themselves) to owner or platform, by any endpoint', async () => {
      await http()
        .post(`/users/${u.targetA}/roles`)
        .set(bearer(managerToken))
        .send({ role_id: globalRole.owner })
        .expect(403);
      await http()
        .post(`/users/${u.managerA}/roles`)
        .set(bearer(managerToken))
        .send({ role_id: globalRole.owner })
        .expect(403);
      await http()
        .post(`/users/${u.targetA}/roles`)
        .set(bearer(managerToken))
        .send({ role_id: globalRole.superadmin })
        .expect(403);
      await http()
        .patch(`/users/${u.targetA}/role`)
        .set(bearer(managerToken))
        .send({ role: 'owner' })
        .expect(403);
      await http()
        .patch(`/users/${u.managerA}/role`)
        .set(bearer(managerToken))
        .send({ role: 'owner' })
        .expect(403);
      await http()
        .patch(`/users/${u.targetA}/role`)
        .set(bearer(managerToken))
        .send({ role: 'superadmin' })
        .expect(403);
      const held = await q(
        "SELECT r.name FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id = ANY($1) AND r.name IN ('owner','superadmin') AND r.tenant_id IS NULL",
        [[u.targetA, u.managerA]],
      );
      expect(held.length).toBe(0);
    });

    it('not even the tenant owner or the platform admin can hand out the platform role through the tenant API', async () => {
      await http()
        .post(`/users/${u.targetA}/roles`)
        .set(bearer(ownerToken))
        .send({ role_id: globalRole.superadmin })
        .expect(403);
      await http()
        .patch(`/users/${u.targetA}/role`)
        .set(bearer(ownerToken))
        .send({ role: 'superadmin' })
        .expect(403);
      await http()
        .post(`/users/${u.targetA}/roles`)
        .set(bearer(platformToken))
        .set('x-tenant-id', tenantA)
        .send({ role_id: globalRole.superadmin })
        .expect(403);
    });

    it('legitimate administration still works: owner assigns a custom role; manager assigns a cashier role', async () => {
      const [role] = await q<{ id: string }>(
        'SELECT id FROM roles WHERE tenant_id=$1 AND name=$2',
        [tenantA, `Supervisor HTTP ${RUN}`],
      );
      await http()
        .post(`/users/${u.targetA}/roles`)
        .set(bearer(ownerToken))
        .send({ role_id: role.id })
        .expect(201);
      await http()
        .post(`/users/${u.cashierA}/roles`)
        .set(bearer(managerToken))
        .send({ role_id: globalRole.manager })
        .expect(201);
      await http()
        .delete(`/users/${u.cashierA}/roles/${globalRole.manager}`)
        .set(bearer(managerToken))
        .expect(200);
    });

    it('owner may promote to owner (the system ownership mechanism is intact)', async () => {
      await http()
        .post(`/users/${u.targetA}/roles`)
        .set(bearer(ownerToken))
        .send({ role_id: globalRole.owner })
        .expect(201);
      await http()
        .delete(`/users/${u.targetA}/roles/${globalRole.owner}`)
        .set(bearer(ownerToken))
        .expect(200);
    });

    it('PRE-FIX token of a tenant owner naming superadmin: no platform access, no tenant switching', async () => {
      await http()
        .get('/probe/platform')
        .set(bearer(forgedOldShape))
        .set('x-tenant-id', tenantB)
        .expect(403);
      const list = await http()
        .get('/access-control/roles')
        .set(bearer(forgedOldShape))
        .set('x-tenant-id', tenantB)
        .expect(200);
      // still scoped to its own tenant (A), never B
      expect(
        list.body.some((r: { name: string }) => r.name.startsWith('B-Only')),
      ).toBe(false);
    });

    it('a token whose platform_admin claim was injected for a tenant identity is also refused', async () => {
      const forgedClaim = jwt.sign(
        {
          sub: u.ownerA,
          email: email('ownerA'),
          role: 'owner',
          roles: ['owner'],
          platform_admin: true,
          tenant_id: tenantA,
          session_id: randomUUID(),
        },
        SECRET,
        { expiresIn: '15m' },
      );
      await http().get('/probe/platform').set(bearer(forgedClaim)).expect(403);
    });

    it('the genuine platform admin keeps access and tenant selection (real login token and a pre-change legacy token)', async () => {
      const ok = await http()
        .get('/probe/platform')
        .set(bearer(platformToken))
        .set('x-tenant-id', tenantB)
        .expect(200);
      expect(ok.body.tenant).toBe(tenantB);
      const legacy = jwt.sign(
        {
          sub: u.platform,
          email: email('platform'),
          role: 'superadmin',
          roles: ['superadmin'],
          tenant_id: null,
          session_id: randomUUID(),
        },
        SECRET,
        { expiresIn: '15m' },
      );
      await http()
        .get('/probe/platform')
        .set(bearer(legacy))
        .set('x-tenant-id', tenantA)
        .expect(200);
      const list = await http()
        .get('/access-control/roles')
        .set(bearer(platformToken))
        .set('x-tenant-id', tenantB)
        .expect(200);
      expect(
        list.body.some((r: { name: string }) => r.name.startsWith('B-Only')),
      ).toBe(true);
    });

    it('legitimate roles keep their ordinary permissions (no regression)', async () => {
      await http().get('/users').set(bearer(managerToken)).expect(200);
      const cashierToken = (await login('cashierA')).access_token;
      await http().get('/users').set(bearer(cashierToken)).expect(200);
      await http()
        .post('/users')
        .set(bearer(cashierToken))
        .send({
          email: email('x2'),
          name: 'x',
          password: 'password123',
          role: 'cashier',
        })
        .expect(403);
    });
  });

  // =====================================================================
  describe('concurrency and conflicting changes', () => {
    it('20 parallel direct inserts of reserved names all fail', async () => {
      const names = Array.from({ length: 20 }, (_, i) =>
        i % 2 ? 'SuperAdmin' : ' owner ',
      );
      const results = await Promise.allSettled(
        names.map(async (name) => {
          const c = new PgClient({
            connectionString: process.env.DATABASE_URL,
          });
          await c.connect();
          try {
            return await c.query(
              'INSERT INTO roles (tenant_id, name, is_system) VALUES ($1,$2,false)',
              [tenantA, name],
            );
          } finally {
            await c.end();
          }
        }),
      );
      expect(results.every((r) => r.status === 'rejected')).toBe(true);
    });

    it('10 parallel creates of the same custom role: exactly one succeeds, the rest conflict', async () => {
      const ownerToken = (await login('ownerA')).access_token;
      const name = `Parallel ${RUN}`;
      const res = await Promise.all(
        Array.from({ length: 10 }, () =>
          http()
            .post('/access-control/roles')
            .set(bearer(ownerToken))
            .send({ name }),
        ),
      );
      const statuses = res.map((r) => r.status).sort();
      expect(statuses.filter((s) => s === 201).length).toBe(1);
      expect(statuses.filter((s) => s === 409).length).toBe(9);
      res
        .filter((r) => r.status === 201)
        .forEach((r) => createdRoleIds.push(r.body.id));
    });

    it('10 parallel owner-promotion attempts by a manager: all refused, nothing granted', async () => {
      const managerToken = (await login('managerA')).access_token;
      const res = await Promise.all(
        Array.from({ length: 10 }, () =>
          http()
            .post(`/users/${u.managerA}/roles`)
            .set(bearer(managerToken))
            .send({ role_id: globalRole.owner }),
        ),
      );
      expect(res.every((r) => r.status === 403)).toBe(true);
      expect(
        (
          await q('SELECT 1 FROM user_roles WHERE user_id=$1 AND role_id=$2', [
            u.managerA,
            globalRole.owner,
          ])
        ).length,
      ).toBe(0);
    });

    it('conflicting grant/revoke of the same legitimate role leaves a consistent state (no duplicate, no error 500)', async () => {
      const ownerToken = (await login('ownerA')).access_token;
      const [role] = await q<{ id: string }>(
        'SELECT id FROM roles WHERE tenant_id=$1 AND name=$2',
        [tenantA, `Supervisor HTTP ${RUN}`],
      );
      await q('DELETE FROM user_roles WHERE user_id=$1 AND role_id=$2', [
        u.cashierA,
        role.id,
      ]);
      const ops = [
        ...Array.from({ length: 6 }, () =>
          http()
            .post(`/users/${u.cashierA}/roles`)
            .set(bearer(ownerToken))
            .send({ role_id: role.id }),
        ),
        ...Array.from({ length: 4 }, () =>
          http()
            .delete(`/users/${u.cashierA}/roles/${role.id}`)
            .set(bearer(ownerToken)),
        ),
      ];
      const res = await Promise.all(ops);
      expect(res.every((r) => r.status < 500)).toBe(true);
      const rows = await q(
        'SELECT 1 FROM user_roles WHERE user_id=$1 AND role_id=$2',
        [u.cashierA, role.id],
      );
      expect(rows.length).toBeLessThanOrEqual(1);
    });
  });
});
