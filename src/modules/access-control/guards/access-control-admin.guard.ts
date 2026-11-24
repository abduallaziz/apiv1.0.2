import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { isOwnerOrPlatformAdmin } from '../../../core/security/platform-identity';

// Mirrors the existing SuperAdminGuard pattern (modules/superadmin/guards/
// superadmin.guard.ts) exactly — a hardcoded role check, not a customizable
// permission. This is deliberate: "who can manage permissions" must never be
// stored in tenant_role_permissions, or whoever currently holds that access
// could grant/revoke it for themselves or others.
@Injectable()
export class AccessControlAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // R-01: tenant owner (global owner role, sanitised in the token) or a
    // platform administrator — never a tenant-chosen role name.
    if (!user || !isOwnerOrPlatformAdmin(user)) {
      throw new ForbiddenException('Owner or superadmin access required');
    }

    return true;
  }
}
