import { ForbiddenException, Logger } from '@nestjs/common';
import { PermissionsService } from './permissions.service';
import { JwtPayload } from '../../shared/types/jwt-payload.type';

// Single source of truth for "is this authenticated user allowed
// requiredPermission" — extracted verbatim from PermissionGuard.canActivate
// (byte-identical decision logic, not a reimplementation) so PermissionGuard
// (every HTTP route) and ActionExecutorService (#21 Phase 7 authorization
// patch — scan-triggered actions, which never go through an HTTP route/
// guard at all) make this decision through exactly one code path. Adding a
// second caller must never mean a second copy of superadmin/test-tenant
// bypass rules, the owner force-true rule (still inside PermissionsService.
// hasPermission itself, untouched), or the shadow-mode hybrid-permission
// comparison — all of that stays exactly as it already was.
const UNRESTRICTED_TEST_TENANT_IDS = ['9bcd3369-d664-47c8-b297-3bc9b429aacf'];

function enforceHybridPermissions(): boolean {
  return process.env.ENFORCE_HYBRID_PERMISSIONS === 'true';
}

async function safeHasPermissionForUser(
  permissionsService: PermissionsService,
  logger: Logger,
  userId: string,
  permissionKey: string,
  tenantId?: string | null,
): Promise<boolean | null> {
  try {
    return await permissionsService.hasPermissionForUser(
      userId,
      permissionKey,
      tenantId,
    );
  } catch (err) {
    logger.error(
      `[ShadowMode] hasPermissionForUser threw for user=${userId} key=${permissionKey}: ${err instanceof Error ? err.message : err}`,
    );
    return null;
  }
}

export async function resolveUserPermission(
  permissionsService: PermissionsService,
  logger: Logger,
  user: JwtPayload | undefined,
  requiredPermission: string,
): Promise<boolean> {
  if (!user) throw new ForbiddenException('No authenticated user');

  const roles: string[] = Array.isArray(user.roles)
    ? user.roles
    : user.role
      ? [user.role]
      : [];

  // Superadmin bypasses all permission checks
  if (roles.includes('superadmin')) return true;

  // Internal QA/demo tenant bypasses all permission checks
  if (UNRESTRICTED_TEST_TENANT_IDS.includes(user.tenant_id)) return true;

  const [legacyGranted, hybridGranted] = await Promise.all([
    permissionsService.hasPermission(
      user.role,
      requiredPermission,
      user.tenant_id,
    ),
    safeHasPermissionForUser(
      permissionsService,
      logger,
      user.sub,
      requiredPermission,
      user.tenant_id,
    ),
  ]);

  if (hybridGranted !== null && hybridGranted !== legacyGranted) {
    logger.warn(
      `[ShadowMode] Permission divergence: user=${user.sub} key=${requiredPermission} ` +
        `tenant=${user.tenant_id ?? 'null'} legacy=${legacyGranted} hybrid=${hybridGranted}`,
    );
  }

  return enforceHybridPermissions() && hybridGranted !== null
    ? hybridGranted
    : legacyGranted;
}
