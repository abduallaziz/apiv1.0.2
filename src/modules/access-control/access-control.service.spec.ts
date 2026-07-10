import { ForbiddenException } from '@nestjs/common';
import { AccessControlService } from './access-control.service';
import { AccessControlRepository, RoleRow } from './access-control.repository';
import { PermissionsService } from '../../core/permissions/permissions.service';
import { AuditService } from '../../core/audit/audit.service';
import { TenantContext } from '../../core/tenant/tenant-context';
import { JwtPayload } from '../../shared/types/jwt-payload.type';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

const TIMESTAMPS = { created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' };
const OWNER_ROLE: RoleRow = { id: 'role-owner', name: 'owner', description: null, tenant_id: null, is_system: true, ...TIMESTAMPS };
const SUPERADMIN_ROLE: RoleRow = { id: 'role-superadmin', name: 'superadmin', description: null, tenant_id: null, is_system: true, ...TIMESTAMPS };
const MANAGER_ROLE: RoleRow = { id: 'role-manager', name: 'manager', description: null, tenant_id: null, is_system: true, ...TIMESTAMPS };
const TENANT_B_ROLE: RoleRow = { id: 'role-tenant-b-custom', name: 'Custom B Role', description: null, tenant_id: TENANT_B, is_system: false, ...TIMESTAMPS };

function actor(overrides: Partial<JwtPayload> = {}): JwtPayload {
  return {
    sub: 'user-1',
    email: 'owner@tenant-a.com',
    role: 'owner',
    tenant_id: TENANT_A,
    session_id: 'sess-1',
    business_type: null,
    activity: null,
    ...overrides,
  };
}

function tenantCtx(tenantId: string | null = TENANT_A): TenantContext {
  return new TenantContext(tenantId, null);
}

function buildService(overrides: {
  roles?: Record<string, RoleRow>;
  permission?: { name: string; resource: string } | null;
  override?: { is_granted: boolean } | null;
  overridesForRole?: { permission_key: string; is_granted: boolean }[];
} = {}) {
  const repo = {
    listPermissionGroups: jest.fn(),
    listPermissionsCatalog: jest.fn().mockResolvedValue([]),
    listRolesForTenant: jest.fn(),
    getRoleById: jest.fn(async (id: string) => overrides.roles?.[id] ?? null),
    getPermissionByKey: jest.fn().mockResolvedValue(
      overrides.permission !== undefined ? overrides.permission : { name: 'expenses.approve', resource: 'expenses' },
    ),
    countUsersForRole: jest.fn().mockResolvedValue(0),
    countCustomizedPermissions: jest.fn().mockResolvedValue(0),
    getOverride: jest.fn().mockResolvedValue(overrides.override ?? null),
    listOverridesForRole: jest.fn().mockResolvedValue(overrides.overridesForRole ?? []),
    upsertOverride: jest.fn().mockResolvedValue(undefined),
    deleteOverride: jest.fn().mockResolvedValue(undefined),
    deleteAllOverridesForRole: jest.fn().mockResolvedValue(undefined),
  } as unknown as AccessControlRepository;

  const permissionsService = {
    getRolePermissions: jest.fn().mockResolvedValue([]),
    getResolutionDetail: jest.fn().mockResolvedValue({ grantedKeys: new Set(), overrides: new Map() }),
    hasPermission: jest.fn().mockResolvedValue(false),
    invalidateRole: jest.fn().mockResolvedValue(undefined),
  } as unknown as PermissionsService;

  const audit = {
    log: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;

  const service = new AccessControlService(repo, permissionsService, audit);
  return { service, repo, permissionsService, audit };
}

describe('AccessControlService — S5 Stage C', () => {
  describe('protected roles cannot be modified', () => {
    it.each([
      ['owner', OWNER_ROLE],
      ['superadmin', SUPERADMIN_ROLE],
    ])('rejects updatePermission for the %s role', async (_label, role) => {
      const { service } = buildService({ roles: { [role.id]: role } });

      await expect(
        service.updatePermission(role.id, 'expenses.approve', true, tenantCtx(), actor()),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects resetRole for the owner role', async () => {
      const { service } = buildService({ roles: { [OWNER_ROLE.id]: OWNER_ROLE } });

      await expect(service.resetRole(OWNER_ROLE.id, tenantCtx(), actor())).rejects.toThrow(ForbiddenException);
    });

    it('allows updatePermission for an editable role (manager)', async () => {
      const { service, repo } = buildService({ roles: { [MANAGER_ROLE.id]: MANAGER_ROLE } });

      await expect(
        service.updatePermission(MANAGER_ROLE.id, 'expenses.approve', false, tenantCtx(), actor()),
      ).resolves.toBeDefined();
      expect(repo.upsertOverride).toHaveBeenCalledWith(TENANT_A, MANAGER_ROLE.id, 'expenses.approve', false);
    });
  });

  describe('tenant isolation', () => {
    it('rejects access to a role owned by a different tenant', async () => {
      const { service } = buildService({ roles: { [TENANT_B_ROLE.id]: TENANT_B_ROLE } });

      await expect(
        service.updatePermission(TENANT_B_ROLE.id, 'expenses.approve', true, tenantCtx(TENANT_A), actor()),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows a tenant to manage its own custom role', async () => {
      const { service, repo } = buildService({ roles: { [TENANT_B_ROLE.id]: TENANT_B_ROLE } });

      await expect(
        service.updatePermission(TENANT_B_ROLE.id, 'expenses.approve', true, tenantCtx(TENANT_B), actor({ tenant_id: TENANT_B })),
      ).resolves.toBeDefined();
      expect(repo.upsertOverride).toHaveBeenCalledWith(TENANT_B, TENANT_B_ROLE.id, 'expenses.approve', true);
    });

    it('allows access to system roles from any tenant', async () => {
      const { service } = buildService({ roles: { [MANAGER_ROLE.id]: MANAGER_ROLE } });

      await expect(
        service.updatePermission(MANAGER_ROLE.id, 'expenses.approve', true, tenantCtx(TENANT_B), actor({ tenant_id: TENANT_B })),
      ).resolves.toBeDefined();
    });
  });

  describe('platform/superadmin permission rejection', () => {
    it('rejects granting a permission whose resource is superadmin', async () => {
      const { service } = buildService({
        roles: { [MANAGER_ROLE.id]: MANAGER_ROLE },
        permission: { name: 'superadmin.queue.manage', resource: 'superadmin' },
      });

      await expect(
        service.updatePermission(MANAGER_ROLE.id, 'superadmin.queue.manage', true, tenantCtx(), actor()),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows granting a normal (non-superadmin) permission', async () => {
      const { service } = buildService({
        roles: { [MANAGER_ROLE.id]: MANAGER_ROLE },
        permission: { name: 'expenses.approve', resource: 'expenses' },
      });

      await expect(
        service.updatePermission(MANAGER_ROLE.id, 'expenses.approve', true, tenantCtx(), actor()),
      ).resolves.toBeDefined();
    });
  });

  describe('reset behavior — delete, never rewrite', () => {
    it('resetPermission deletes the override row rather than writing a matching value', async () => {
      const { service, repo, permissionsService } = buildService({
        roles: { [MANAGER_ROLE.id]: MANAGER_ROLE },
        override: { is_granted: false },
      });

      await service.resetPermission(MANAGER_ROLE.id, 'expenses.approve', tenantCtx(), actor());

      expect(repo.deleteOverride).toHaveBeenCalledWith(TENANT_A, MANAGER_ROLE.id, 'expenses.approve');
      expect(repo.upsertOverride).not.toHaveBeenCalled();
      expect(permissionsService.invalidateRole).toHaveBeenCalledWith('manager', TENANT_A);
    });

    it('resetRole deletes all overrides for the role and never re-writes them', async () => {
      const overridesForRole = [
        { permission_key: 'expenses.approve', is_granted: false },
        { permission_key: 'payroll.view', is_granted: true },
      ];
      const { service, repo } = buildService({
        roles: { [MANAGER_ROLE.id]: MANAGER_ROLE },
        overridesForRole,
      });

      const result = await service.resetRole(MANAGER_ROLE.id, tenantCtx(), actor());

      expect(repo.deleteAllOverridesForRole).toHaveBeenCalledWith(TENANT_A, MANAGER_ROLE.id);
      expect(repo.upsertOverride).not.toHaveBeenCalled();
      expect(result.reset_count).toBe(2);
    });
  });

  describe('audit before/after', () => {
    it('logs before=inherited_default and after=granted when granting a fresh permission', async () => {
      const { service, audit } = buildService({
        roles: { [MANAGER_ROLE.id]: MANAGER_ROLE },
        override: null,
      });

      await service.updatePermission(MANAGER_ROLE.id, 'expenses.approve', true, tenantCtx(), actor());

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          tenant_id: TENANT_A,
          actor_id: 'user-1',
          actor_role: 'owner',
          action: 'role_permission.granted',
          resource_type: 'role_permission',
          before_data: { permission_key: 'expenses.approve', state: 'inherited_default' },
          after_data: { permission_key: 'expenses.approve', state: 'granted' },
        }),
      );
    });

    it('logs before=granted and after=denied when revoking an existing grant', async () => {
      const { service, audit } = buildService({
        roles: { [MANAGER_ROLE.id]: MANAGER_ROLE },
        override: { is_granted: true },
      });

      await service.updatePermission(MANAGER_ROLE.id, 'expenses.approve', false, tenantCtx(), actor());

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'role_permission.revoked',
          before_data: { permission_key: 'expenses.approve', state: 'granted' },
          after_data: { permission_key: 'expenses.approve', state: 'denied' },
        }),
      );
    });

    it('logs one audit entry per removed override on resetRole (not one vague entry)', async () => {
      const overridesForRole = [
        { permission_key: 'expenses.approve', is_granted: false },
        { permission_key: 'payroll.view', is_granted: true },
      ];
      const { service, audit } = buildService({
        roles: { [MANAGER_ROLE.id]: MANAGER_ROLE },
        overridesForRole,
      });

      await service.resetRole(MANAGER_ROLE.id, tenantCtx(), actor());

      expect(audit.log).toHaveBeenCalledTimes(2);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          before_data: { permission_key: 'expenses.approve', state: 'denied' },
          after_data: { permission_key: 'expenses.approve', state: 'inherited_default' },
        }),
      );
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          before_data: { permission_key: 'payroll.view', state: 'granted' },
          after_data: { permission_key: 'payroll.view', state: 'inherited_default' },
        }),
      );
    });

    it('audit failures never throw (fire-and-forget)', async () => {
      const { service, audit } = buildService({ roles: { [MANAGER_ROLE.id]: MANAGER_ROLE } });
      (audit.log as jest.Mock).mockRejectedValue(new Error('audit db down'));

      await expect(
        service.updatePermission(MANAGER_ROLE.id, 'expenses.approve', true, tenantCtx(), actor()),
      ).resolves.toBeDefined();
    });
  });

  describe('GET permissions catalog — superadmin resource visibility', () => {
    it('does not ask the repository to include superadmin-resource permissions for an owner', async () => {
      const { service, repo } = buildService();

      await service.listPermissions(actor({ role: 'owner' }));

      expect(repo.listPermissionsCatalog).toHaveBeenCalledWith(false);
    });

    it('asks the repository to include superadmin-resource permissions for a superadmin', async () => {
      const { service, repo } = buildService();

      await service.listPermissions(actor({ role: 'superadmin' }));

      expect(repo.listPermissionsCatalog).toHaveBeenCalledWith(true);
    });

    it('repository excludes resource=superadmin rows when includeSuperadmin is false (integration-level check on the query builder)', async () => {
      const calls: { eqCalls: [string, unknown][] } = { eqCalls: [] };
      const fakeSupabase = {
        from: () => {
          const builder: any = {
            select: () => builder,
            order: () => builder,
            neq: (col: string, val: unknown) => {
              calls.eqCalls.push([col, val]);
              return builder;
            },
            then: (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null }),
          };
          return builder;
        },
      };
      const { AccessControlRepository } = require('./access-control.repository');
      const repoInstance = new AccessControlRepository(fakeSupabase as any);

      await repoInstance.listPermissionsCatalog(false);
      expect(calls.eqCalls).toContainEqual(['resource', 'superadmin']);

      calls.eqCalls = [];
      await repoInstance.listPermissionsCatalog(true);
      expect(calls.eqCalls).not.toContainEqual(['resource', 'superadmin']);
    });
  });

  describe('cache invalidation', () => {
    it('invalidates the tenant-scoped role cache after a grant/revoke', async () => {
      const { service, permissionsService } = buildService({ roles: { [MANAGER_ROLE.id]: MANAGER_ROLE } });

      await service.updatePermission(MANAGER_ROLE.id, 'expenses.approve', true, tenantCtx(), actor());

      expect(permissionsService.invalidateRole).toHaveBeenCalledWith('manager', TENANT_A);
    });
  });
});
