import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsService } from './permissions.service';
import { REQUIRE_PERMISSION_KEY } from './require-permission.decorator';

// Internal QA/demo tenant ("Sefay Demo", owner@sefay.com) — exempted from
// permission gating so it can exercise every feature from one account
// without affecting any real customer's role_permissions (those are
// role-scoped system-wide, not per-tenant).
const UNRESTRICTED_TEST_TENANT_IDS = ['9bcd3369-d664-47c8-b297-3bc9b429aacf'];

// Phase C rollout switch — env-gated (not a code change) so the eventual
// cutover from legacy hasPermission() to hasPermissionForUser() needs no
// code change: flip ENFORCE_HYBRID_PERMISSIONS=true in the environment once
// the shadow-mode log review confirms zero unexplained divergence. Read
// live on every request (not cached into a module-level constant at import
// time) so the switch takes effect immediately.  Defaults to false
// (shadow-only, zero behavior change) so simply not setting this var is
// the safe state.
function enforceHybridPermissions(): boolean {
  return process.env.ENFORCE_HYBRID_PERMISSIONS === 'true';
}

@Injectable()
export class PermissionGuard implements CanActivate {
  private readonly logger = new Logger(PermissionGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly permissionsService: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermission = this.reflector.getAllAndOverride<string>(
      REQUIRE_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No permission required on this route
    if (!requiredPermission) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) throw new ForbiddenException('No authenticated user');

    // Phase 2 of the multi-role migration — user.roles may be absent on a
    // JWT signed before this field existed, so fall back to [user.role].
    const roles: string[] = Array.isArray(user.roles) ? user.roles : (user.role ? [user.role] : []);

    // Superadmin bypasses all permission checks
    if (roles.includes('superadmin')) return true;

    // Internal QA/demo tenant bypasses all permission checks
    if (UNRESTRICTED_TEST_TENANT_IDS.includes(user.tenant_id)) return true;

    // S5 Stage B: tenantId already lives on the JWT-derived user object via
    // TenantGuard's resolution; passing it through lets PermissionsService
    // apply per-tenant overrides. No change to this guard's public contract,
    // bypass order, or exception behavior.
    //
    // Phase C of the Hybrid RBAC+ABAC model — SHADOW MODE. The legacy
    // single-role hasPermission() result is still what's actually enforced
    // below; hasPermissionForUser() (multi-role + per-user overrides) runs
    // alongside it purely to compare and log divergence. This is
    // deliberate, not a placeholder: real authorization must not depend on
    // a code path that hasn't been observed against production traffic yet.
    // Flip ENFORCE_HYBRID_PERMISSIONS to true only after the planned 24h
    // log-review window (see rollout plan) shows zero unexplained
    // divergence — that is the one-line cutover, nothing else in this
    // guard changes at that point.
    const [legacyGranted, hybridGranted] = await Promise.all([
      this.permissionsService.hasPermission(user.role, requiredPermission, user.tenant_id),
      this.safeHasPermissionForUser(user.sub, requiredPermission, user.tenant_id),
    ]);

    if (hybridGranted !== null && hybridGranted !== legacyGranted) {
      this.logger.warn(
        `[ShadowMode] Permission divergence: user=${user.sub} key=${requiredPermission} ` +
        `tenant=${user.tenant_id ?? 'null'} legacy=${legacyGranted} hybrid=${hybridGranted}`,
      );
    }

    const granted = enforceHybridPermissions() && hybridGranted !== null
      ? hybridGranted
      : legacyGranted;

    if (!granted) {
      throw new ForbiddenException(
        `Permission denied: ${requiredPermission}`,
      );
    }

    return true;
  }

  // Shadow-mode safety net: hasPermissionForUser() is new, unproven-in-
  // production code. A bug or transient DB error in it must never affect
  // real enforcement while ENFORCE_HYBRID_PERMISSIONS is false — caught and
  // logged here, returns null (treated as "no shadow data" above) rather
  // than throwing or silently resolving to a boolean that could look like
  // a real divergence.
  private async safeHasPermissionForUser(
    userId: string,
    permissionKey: string,
    tenantId?: string | null,
  ): Promise<boolean | null> {
    try {
      return await this.permissionsService.hasPermissionForUser(userId, permissionKey, tenantId);
    } catch (err) {
      this.logger.error(
        `[ShadowMode] hasPermissionForUser threw for user=${userId} key=${permissionKey}: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
  }
}