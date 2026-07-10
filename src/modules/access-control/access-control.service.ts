import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessControlRepository, RoleRow } from './access-control.repository';
import { PermissionsService } from '../../core/permissions/permissions.service';
import { AuditService } from '../../core/audit/audit.service';
import { TenantContext } from '../../core/tenant/tenant-context';
import { JwtPayload } from '../../shared/types/jwt-payload.type';

// Roles that can never be mutated through this API, even by an owner acting
// on their own tenant — approved S5 Stage C decision #2. An owner editing
// their own "owner" role is a self-lockout risk; "superadmin" is
// platform-level and never tenant-editable at all.
const PROTECTED_ROLE_NAMES = new Set(['owner', 'superadmin']);

type PermissionState = 'granted' | 'denied' | 'inherited_default';

function stateFromOverride(override: { is_granted: boolean } | null): PermissionState {
  if (!override) return 'inherited_default';
  return override.is_granted ? 'granted' : 'denied';
}

@Injectable()
export class AccessControlService {
  constructor(
    private readonly repo: AccessControlRepository,
    private readonly permissionsService: PermissionsService,
    private readonly audit: AuditService,
  ) {}

  async listPermissionGroups() {
    return this.repo.listPermissionGroups();
  }

  async listPermissions(actor: JwtPayload) {
    const includeSuperadmin = actor.role === 'superadmin';
    return this.repo.listPermissionsCatalog(includeSuperadmin);
  }

  async listRoles(tenant: TenantContext) {
    const tenantId = this.requireTenantId(tenant);
    const roles = await this.repo.listRolesForTenant(tenantId);

    return Promise.all(
      roles.map(async (role) => {
        const [userCount, grantedKeys, customizedCount] = await Promise.all([
          this.repo.countUsersForRole(role.id, tenantId),
          this.permissionsService.getRolePermissions(role.name, tenantId),
          this.repo.countCustomizedPermissions(tenantId, role.id),
        ]);

        return {
          id: role.id,
          name: role.name,
          description: role.description,
          is_system: role.is_system,
          user_count: userCount,
          permission_count: grantedKeys.length,
          customized_permission_count: customizedCount,
          created_at: role.created_at,
          updated_at: role.updated_at,
        };
      }),
    );
  }

  async createRole(name: string, description: string | null, tenant: TenantContext, actor: JwtPayload) {
    const tenantId = this.requireTenantId(tenant);
    const trimmed = name.trim();
    if (!trimmed) throw new ForbiddenException('Role name is required');

    let role: RoleRow;
    try {
      role = await this.repo.createRole(tenantId, trimmed, description);
    } catch (err) {
      if (err instanceof Error && err.message === 'DUPLICATE_ROLE_NAME') {
        throw new ForbiddenException(`A role named "${trimmed}" already exists for this tenant`);
      }
      throw err;
    }

    this.audit
      .log({
        tenant_id: tenant.tenantId,
        actor_id: actor.sub,
        actor_role: actor.role,
        action: 'role.created',
        resource_type: 'role',
        resource_id: role.id,
        after_data: { name: role.name, description: role.description },
      })
      .catch(() => {});

    return {
      id: role.id,
      name: role.name,
      description: role.description,
      is_system: role.is_system,
      user_count: 0,
      permission_count: 0,
      customized_permission_count: 0,
      created_at: role.created_at,
      updated_at: role.updated_at,
    };
  }

  async deleteRole(roleId: string, tenant: TenantContext, actor: JwtPayload) {
    const tenantId = this.requireTenantId(tenant);
    const role = await this.getAccessibleRoleOrThrow(roleId, tenantId);

    // Stricter than getEditableRoleOrThrow's PROTECTED_ROLE_NAMES check —
    // deletion must be impossible for ANY system role, not just the two
    // by-name-protected ones, since a system role's tenant_id is null and
    // shared across every tenant. Only a role this tenant actually owns
    // (tenant_id === tenantId) may ever be deleted.
    if (role.tenant_id !== tenantId) {
      throw new ForbiddenException('System roles cannot be deleted');
    }

    const userCount = await this.repo.countUsersForRole(roleId, tenantId);
    if (userCount > 0) {
      throw new ForbiddenException(
        `Cannot delete role "${role.name}" — ${userCount} user(s) are still assigned to it`,
      );
    }

    await this.repo.deleteAllOverridesForRole(tenantId, roleId);
    await this.repo.deleteRole(tenantId, roleId);
    await this.permissionsService.invalidateRole(role.name, tenantId);

    this.audit
      .log({
        tenant_id: tenant.tenantId,
        actor_id: actor.sub,
        actor_role: actor.role,
        action: 'role.deleted',
        resource_type: 'role',
        resource_id: roleId,
        before_data: { name: role.name, description: role.description },
      })
      .catch(() => {});

    return { role_id: roleId, deleted: true };
  }

  async getRolePermissions(roleId: string, tenant: TenantContext, actor: JwtPayload) {
    const tenantId = this.requireTenantId(tenant);
    const role = await this.getAccessibleRoleOrThrow(roleId, tenantId);

    const [catalog, detail] = await Promise.all([
      this.listPermissions(actor),
      this.permissionsService.getResolutionDetail(role.name, tenantId),
    ]);

    return catalog.map((permission) => ({
      permission_key: permission.name,
      group_code: permission.group_code,
      description: permission.description,
      granted: detail.grantedKeys.has(permission.name),
      source: detail.overrides.has(permission.name) ? 'tenant_override' : 'global',
    }));
  }

  async updatePermission(
    roleId: string,
    permissionKey: string,
    isGranted: boolean,
    tenant: TenantContext,
    actor: JwtPayload,
  ) {
    const tenantId = this.requireTenantId(tenant);
    const role = await this.getEditableRoleOrThrow(roleId, tenantId);
    await this.assertPermissionIsCustomizable(permissionKey);

    const before = await this.repo.getOverride(tenantId, roleId, permissionKey);
    const beforeState = stateFromOverride(before);

    await this.repo.upsertOverride(tenantId, roleId, permissionKey, isGranted);
    await this.permissionsService.invalidateRole(role.name, tenantId);

    const afterState: PermissionState = isGranted ? 'granted' : 'denied';

    this.logPermissionChange({
      tenant,
      actor,
      action: isGranted ? 'role_permission.granted' : 'role_permission.revoked',
      roleId,
      permissionKey,
      beforeState,
      afterState,
    });

    return { role_id: roleId, permission_key: permissionKey, granted: isGranted, source: 'tenant_override' as const };
  }

  async resetPermission(
    roleId: string,
    permissionKey: string,
    tenant: TenantContext,
    actor: JwtPayload,
  ) {
    const tenantId = this.requireTenantId(tenant);
    const role = await this.getEditableRoleOrThrow(roleId, tenantId);

    const before = await this.repo.getOverride(tenantId, roleId, permissionKey);
    const beforeState = stateFromOverride(before);

    // Reset means DELETE — never write a row matching the current global
    // value (approved decision #3). If there was nothing to delete, this is
    // a no-op, not an error.
    await this.repo.deleteOverride(tenantId, roleId, permissionKey);
    await this.permissionsService.invalidateRole(role.name, tenantId);

    this.logPermissionChange({
      tenant,
      actor,
      action: 'role_permission.reset',
      roleId,
      permissionKey,
      beforeState,
      afterState: 'inherited_default',
    });

    const grantedNow = await this.permissionsService.hasPermission(role.name, permissionKey, tenantId);
    return { role_id: roleId, permission_key: permissionKey, granted: grantedNow, source: 'global' as const };
  }

  async resetRole(roleId: string, tenant: TenantContext, actor: JwtPayload) {
    const tenantId = this.requireTenantId(tenant);
    const role = await this.getEditableRoleOrThrow(roleId, tenantId);

    // Fetch every override BEFORE deleting so each one gets its own
    // before/after audit entry — not one vague "role was reset" row.
    const overrides = await this.repo.listOverridesForRole(tenantId, roleId);

    await this.repo.deleteAllOverridesForRole(tenantId, roleId);
    await this.permissionsService.invalidateRole(role.name, tenantId);

    for (const override of overrides) {
      this.logPermissionChange({
        tenant,
        actor,
        action: 'role_permission.reset',
        roleId,
        permissionKey: override.permission_key,
        beforeState: override.is_granted ? 'granted' : 'denied',
        afterState: 'inherited_default',
      });
    }

    return { role_id: roleId, reset_count: overrides.length };
  }

  // ---- internal helpers -------------------------------------------------

  private requireTenantId(tenant: TenantContext): string {
    if (!tenant.tenantId) {
      throw new ForbiddenException('Tenant context required for access-control management');
    }
    return tenant.tenantId;
  }

  private async getAccessibleRoleOrThrow(roleId: string, tenantId: string): Promise<RoleRow> {
    const role = await this.repo.getRoleById(roleId);
    if (!role) throw new NotFoundException('Role not found');

    // System role (usable by every tenant) or this tenant's own custom role.
    if (role.tenant_id !== null && role.tenant_id !== tenantId) {
      throw new ForbiddenException('Cannot access another tenant\'s role');
    }

    return role;
  }

  // Verified explicitly (frontend "custom roles can't be edited" bug report,
  // investigated and found not reproducible): the only names ever blocked
  // here are 'owner'/'superadmin' (PROTECTED_ROLE_NAMES). Every custom
  // tenant role (is_system=false) and every other system role
  // (manager/cashier/worker/inventory_clerk) is editable through this path
  // today — updatePermission()/resetPermission()/resetRole() all route
  // through here and none of them special-case is_system. If a future
  // report reappears, check the frontend's readOnly wiring first
  // (ConfigureRoleSheet sets it from mode==='view', which is only ever true
  // for is_system roles) before assuming this guard changed.
  private async getEditableRoleOrThrow(roleId: string, tenantId: string): Promise<RoleRow> {
    const role = await this.getAccessibleRoleOrThrow(roleId, tenantId);

    if (PROTECTED_ROLE_NAMES.has(role.name)) {
      throw new ForbiddenException(`Role "${role.name}" is protected and cannot be modified`);
    }

    return role;
  }

  // Stopgap, not the real fix — see STATUS.md §83. resource==='superadmin' was
  // the only block here, but `analytics.view.all`/`audit.view.all` carry
  // resource:'analytics'/'audit' and gate platform-wide, cross-tenant data
  // (superadmin/analytics/*, superadmin/audit-logs) despite not being tagged
  // 'superadmin'. Hardcoding the two known keys closes today's confirmed gap;
  // it does not generalize to any *future* platform-only permission added
  // with a non-'superadmin' resource. The durable fix is a schema-level
  // `is_platform_only` flag on `permissions`, plus SuperAdminGuard on every
  // route those permissions gate (added to AnalyticsController/
  // AuditLogsController in this same pass) as the real enforcement boundary —
  // this check is defense-in-depth, not the primary guarantee.
  private static readonly HARDCODED_PLATFORM_ONLY_KEYS = new Set([
    'analytics.view.all',
    'audit.view.all',
  ]);

  private async assertPermissionIsCustomizable(permissionKey: string): Promise<void> {
    const permission = await this.repo.getPermissionByKey(permissionKey);
    if (!permission) throw new NotFoundException('Permission not found');

    if (
      permission.resource === 'superadmin' ||
      AccessControlService.HARDCODED_PLATFORM_ONLY_KEYS.has(permissionKey)
    ) {
      throw new ForbiddenException('Platform-level permissions cannot be granted to a tenant role');
    }
  }

  private logPermissionChange(entry: {
    tenant: TenantContext;
    actor: JwtPayload;
    action: string;
    roleId: string;
    permissionKey: string;
    beforeState: PermissionState;
    afterState: PermissionState;
  }): void {
    // Fire-and-forget, matching the established convention (e.g.
    // AttendanceLinkService) — an audit-write hiccup must never block or
    // fail the actual permission change.
    this.audit
      .log({
        tenant_id: entry.tenant.tenantId,
        actor_id: entry.actor.sub,
        actor_role: entry.actor.role,
        action: entry.action,
        resource_type: 'role_permission',
        resource_id: `${entry.roleId}:${entry.permissionKey}`,
        before_data: { permission_key: entry.permissionKey, state: entry.beforeState },
        after_data: { permission_key: entry.permissionKey, state: entry.afterState },
      })
      .catch(() => {});
  }
}
