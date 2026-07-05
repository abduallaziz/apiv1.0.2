import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsService } from './permissions.service';
import { REQUIRE_PERMISSION_KEY } from './require-permission.decorator';

// Internal QA/demo tenant ("Sefay Demo", owner@sefay.com) — exempted from
// permission gating so it can exercise every feature from one account
// without affecting any real customer's role_permissions (those are
// role-scoped system-wide, not per-tenant).
const UNRESTRICTED_TEST_TENANT_IDS = ['9bcd3369-d664-47c8-b297-3bc9b429aacf'];

@Injectable()
export class PermissionGuard implements CanActivate {
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

    // Superadmin bypasses all permission checks
    if (user.role === 'superadmin') return true;

    // Internal QA/demo tenant bypasses all permission checks
    if (UNRESTRICTED_TEST_TENANT_IDS.includes(user.tenant_id)) return true;

    const granted = await this.permissionsService.hasPermission(
      user.role,
      requiredPermission,
    );

    if (!granted) {
      throw new ForbiddenException(
        `Permission denied: ${requiredPermission}`,
      );
    }

    return true;
  }
}