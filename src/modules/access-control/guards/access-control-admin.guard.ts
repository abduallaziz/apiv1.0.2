import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

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

    // Phase 2 of the multi-role migration — user.roles may be absent on a
    // JWT signed before this field existed, so fall back to [user.role].
    const roles: string[] = Array.isArray(user?.roles) ? user.roles : (user?.role ? [user.role] : []);

    if (!user || (!roles.includes('owner') && !roles.includes('superadmin'))) {
      throw new ForbiddenException('Owner or superadmin access required');
    }

    return true;
  }
}
