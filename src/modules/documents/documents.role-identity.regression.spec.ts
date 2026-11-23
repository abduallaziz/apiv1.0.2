/**
 * R-DOC-01 — the documents module must resolve the issuer's roles by IDENTITY
 * (user_roles by user id -> role id, global-vs-tenant aware), never by the role
 * NAME carried in the JWT.
 *
 * LOCAL DISPOSABLE DATABASE ONLY (docker loopback; see test/local-db). Needs
 * migration 324 (pending) applied. Pre-existing look-alike roles are created
 * with the 324 trigger disabled, locally only (they exist in old data).
 *
 * Each case calls the real GenerationService.authorizeAssets against real
 * tables (roles, user_roles, document_assets, document_asset_permissions,
 * document_approvals).
 */
import { Client as PgClient } from 'pg';
import { randomUUID } from 'crypto';
import { GenerationService, type Actor } from './generation.service';

const ZWSP = String.fromCharCode(0x200b);
const ZWJ = String.fromCharCode(0x200d);
const CYR_A = String.fromCharCode(0x0430);
const LOOPBACK = ['127.0.0.1', 'localhost', '::1', '[::1]'];
const RUN = `rdoc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

describe('R-DOC-01 documents role resolution is identity based', () => {
  let pg: PgClient;
  let svc: GenerationService;
  let tenantA: string;
  let tenantB: string;
  let templateId: string;
  let approver: string;
  const globalRole: Record<string, string> = {};
  const roleIds: string[] = [];
  const userIds: string[] = [];
  const assetIds: string[] = [];
  const NOW = new Date();
  const PUB_AT = new Date(NOW.getTime() - 86400000);

  async function q<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await pg.query(sql, params)).rows as T[];
  }

  async function makeUser(
    tenantId: string,
    legacyRole: string,
    heldRoleIds: string[],
  ): Promise<string> {
    const id = randomUUID();
    await q(
      'INSERT INTO users (id, tenant_id, name, email, password_hash, role, is_active) VALUES ($1,$2,$3,$4,$5,$6,true)',
      [id, tenantId, 'u', `${RUN}.${id}@rdoc.invalid`, 'x', legacyRole],
    );
    for (const r of heldRoleIds) {
      await q('INSERT INTO user_roles (user_id, role_id) VALUES ($1,$2)', [
        id,
        r,
      ]);
    }
    userIds.push(id);
    return id;
  }

  async function makeTenantRole(
    tenantId: string,
    name: string,
  ): Promise<string> {
    const id = randomUUID();
    await pg.query(
      'ALTER TABLE roles DISABLE TRIGGER trg_roles_reserved_name_guard',
    );
    try {
      await q(
        'INSERT INTO roles (id, tenant_id, name, is_system) VALUES ($1,$2,$3,false)',
        [id, tenantId, name],
      );
    } finally {
      await pg.query(
        'ALTER TABLE roles ENABLE TRIGGER trg_roles_reserved_name_guard',
      );
    }
    roleIds.push(id);
    return id;
  }

  /** A stamp asset whose only permission rows are the given role ids (can_use). */
  async function stampFor(allowed: string[]): Promise<string> {
    const id = randomUUID();
    await q(
      `INSERT INTO document_assets (id, tenant_id, category, name, storage_path, mime, status)
       VALUES ($1,$2,'company_stamp','stamp','p/s.png','image/png','active')`,
      [id, tenantA],
    );
    for (const r of allowed) {
      await q(
        'INSERT INTO document_asset_permissions (tenant_id, asset_id, role_id, can_use) VALUES ($1,$2,$3,true)',
        [tenantA, id, r],
      );
    }
    assetIds.push(id);
    return id;
  }

  /** Runs the real authorization. Resolves => allowed. */
  async function authorize(
    assetId: string,
    userId: string,
    claimedRoles: string[],
  ): Promise<'allowed' | 'denied'> {
    const actor: Actor = { userId, roles: claimedRoles };
    try {
      await (svc as any).authorizeAssets(
        pg,
        tenantA,
        {
          templateId,
          versionId: randomUUID(),
          versionCreatedAt: PUB_AT,
          paper: 'A4',
          orientation: 'portrait',
          body: { elements: [{ assetId }] },
        },
        actor,
        null,
      );
      return 'allowed';
    } catch (e: any) {
      if (e?.status === 403) return 'denied';
      throw e;
    }
  }

  beforeAll(async () => {
    const dbHost = new URL(process.env.DATABASE_URL ?? 'postgres://invalid')
      .hostname;
    if (!LOOPBACK.includes(dbHost)) {
      throw new Error(`R-DOC-01 suite refuses to run: ${dbHost} is not loopback`);
    }
    pg = new PgClient({ connectionString: process.env.DATABASE_URL });
    await pg.connect();
    for (const r of await q<{ id: string; name: string }>(
      'SELECT id, name FROM roles WHERE tenant_id IS NULL',
    )) {
      globalRole[r.name] = r.id;
    }
    const trig = await q(
      "SELECT 1 FROM pg_trigger WHERE tgname = 'trg_roles_reserved_name_guard'",
    );
    if (trig.length === 0)
      throw new Error('migration 324 not applied (apply.js --with-pending)');

    tenantA = randomUUID();
    tenantB = randomUUID();
    for (const [id, l] of [
      [tenantA, 'A'],
      [tenantB, 'B'],
    ]) {
      await q(
        'INSERT INTO tenants (id, name, business_type, status) VALUES ($1,$2,$3,$4)',
        [id, `${RUN}-${l}`, 'retail', 'active'],
      );
    }
    approver = await makeUser(tenantA, 'owner', [globalRole.owner]);
    templateId = randomUUID();
    await q(
      `INSERT INTO document_templates (id, tenant_id, doc_type, name, status) VALUES ($1,$2,'custom','t','published')`,
      [templateId, tenantA],
    );
    await q(
      `INSERT INTO document_approvals (tenant_id, doc_type, template_id, approver_id, decision, approved_at)
       VALUES ($1,'custom',$2,$3,'approved',$4)`,
      [tenantA, templateId, approver, NOW],
    );
    // ONLY the privileged-looking assertions need a service instance: authorizeAssets uses just `client`
    svc = new GenerationService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  }, 60000);

  afterAll(async () => {
    try {
      await pg.query(
        'ALTER TABLE roles ENABLE TRIGGER trg_roles_reserved_name_guard',
      );
      await q('DELETE FROM document_asset_permissions WHERE tenant_id = ANY($1)', [[tenantA, tenantB]]);
      // approvals are immutable by trigger: local-only cleanup of this suite's own rows
      await pg.query('ALTER TABLE document_approvals DISABLE TRIGGER trg_document_approvals_immutable');
      await q('DELETE FROM document_approvals WHERE tenant_id = ANY($1)', [[tenantA, tenantB]]);
      await pg.query('ALTER TABLE document_approvals ENABLE TRIGGER trg_document_approvals_immutable');
      await q('DELETE FROM document_assets WHERE tenant_id = ANY($1)', [[tenantA, tenantB]]);
      await q('DELETE FROM document_templates WHERE tenant_id = ANY($1)', [[tenantA, tenantB]]);
      await q('DELETE FROM user_roles WHERE user_id = ANY($1)', [userIds]);
      await q('DELETE FROM users WHERE id = ANY($1)', [userIds]);
      await q('DELETE FROM roles WHERE id = ANY($1)', [roleIds]);
      await q('DELETE FROM tenants WHERE id = ANY($1)', [[tenantA, tenantB]]);
    } finally {
      await pg?.end();
    }
  }, 60000);

  describe('legitimate behaviour is unchanged', () => {
    it('holder of the GLOBAL manager role may use a stamp granted to the global manager role', async () => {
      const stamp = await stampFor([globalRole.manager]);
      const u = await makeUser(tenantA, 'manager', [globalRole.manager]);
      expect(await authorize(stamp, u, ['manager'])).toBe('allowed');
    });

    it('holder of a legitimate custom tenant role may use a stamp granted to it', async () => {
      const sup = await makeTenantRole(tenantA, `Supervisor-${RUN}`);
      const stamp = await stampFor([sup]);
      const u = await makeUser(tenantA, 'cashier', [sup]);
      expect(await authorize(stamp, u, [`Supervisor-${RUN}`])).toBe('allowed');
    });

    it('legacy user without user_roles rows (token roles = users.role) still maps to the GLOBAL role', async () => {
      const stamp = await stampFor([globalRole.cashier]);
      const u = await makeUser(tenantA, 'cashier', []);
      expect(await authorize(stamp, u, ['cashier'])).toBe('allowed');
    });

    it('a role that is not listed is still denied once restrictions exist', async () => {
      const stamp = await stampFor([globalRole.manager]);
      const u = await makeUser(tenantA, 'cashier', [globalRole.cashier]);
      expect(await authorize(stamp, u, ['cashier'])).toBe('denied');
    });
  });

  describe('look-alike roles no longer inherit stamp permissions', () => {
    const variants: Array<[string, string]> = [
      ['exact same name', 'manager'],
      ['different case', 'Manager'],
      ['upper case', 'MANAGER'],
      ['Cyrillic a', `m${CYR_A}nager`],
      ['zero-width space', `man${ZWSP}ager`],
      ['zero-width joiner + separator', `man${ZWJ}_ager`],
    ];

    it.each(variants)(
      'global manager holder is NOT granted a stamp that only a tenant look-alike (%s) may use',
      async (_label, name) => {
        const look = await makeTenantRole(tenantA, name);
        const stamp = await stampFor([look]); // permission for the look-alike only
        const u = await makeUser(tenantA, 'manager', [globalRole.manager]);
        expect(await authorize(stamp, u, ['manager'])).toBe('denied');
      },
    );

    it.each(variants)(
      'a user whose only role is a tenant look-alike (%s) gets nothing, even if the token names it',
      async (_label, name) => {
        const look = await makeTenantRole(tenantA, `${name} `);
        const stamp = await stampFor([look]);
        const u = await makeUser(tenantA, 'cashier', [look]);
        expect(await authorize(stamp, u, [`${name} `])).toBe('denied');
        expect(await authorize(stamp, u, [name])).toBe('denied');
      },
    );

    it('a token that CLAIMS a privileged name the user does not hold gets nothing', async () => {
      const stamp = await stampFor([globalRole.owner]);
      const u = await makeUser(tenantA, 'cashier', [globalRole.cashier]);
      expect(await authorize(stamp, u, ['owner'])).toBe('denied');
    });

    it('a stale token: a role removed from the user stops working immediately', async () => {
      const sup = await makeTenantRole(tenantA, `Stale-${RUN}`);
      const stamp = await stampFor([sup]);
      const u = await makeUser(tenantA, 'cashier', [sup]);
      expect(await authorize(stamp, u, [`Stale-${RUN}`])).toBe('allowed');
      await q('DELETE FROM user_roles WHERE user_id = $1 AND role_id = $2', [u, sup]);
      await q('INSERT INTO user_roles (user_id, role_id) VALUES ($1,$2)', [u, globalRole.cashier]);
      expect(await authorize(stamp, u, [`Stale-${RUN}`])).toBe('denied');
    });

    it('a role owned by ANOTHER tenant never counts', async () => {
      const foreign = await makeTenantRole(tenantB, `Foreign-${RUN}`);
      const stamp = await stampFor([foreign]);
      // the 324 guard trigger refuses this assignment; bypass it locally to prove the code is also safe
      const u = await makeUser(tenantA, 'cashier', []);
      await pg.query('ALTER TABLE user_roles DISABLE TRIGGER trg_user_roles_identity_guard');
      try {
        await q('INSERT INTO user_roles (user_id, role_id) VALUES ($1,$2)', [u, foreign]);
      } finally {
        await pg.query('ALTER TABLE user_roles ENABLE TRIGGER trg_user_roles_identity_guard');
      }
      expect(await authorize(stamp, u, [`Foreign-${RUN}`])).toBe('denied');
    });
  });
});
