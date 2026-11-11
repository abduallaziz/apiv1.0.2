import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

/**
 * Restricts a route to the tenant owner (or a platform superadmin).
 * Reads role(s) from request.user, which JwtAuthGuard has already populated
 * from a signature-verified token — the same 'owner' role value the
 * permission system treats as "has everything" (PermissionsService).
 * Tenant scoping is separate: the subscription routes always act on
 * user.tenant_id from that token, never on a client-supplied id.
 */
@Injectable()
export class TenantOwnerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest().user;

    const roles: string[] = Array.isArray(user?.roles)
      ? user.roles
      : user?.role
        ? [user.role]
        : [];

    if (!user || !(roles.includes('owner') || roles.includes('superadmin'))) {
      throw new ForbiddenException(
        'Only the tenant owner can manage the subscription',
      );
    }
    return true;
  }
}
