import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // Phase 2 of the multi-role migration — user.roles may be absent on a
    // JWT signed before this field existed, so fall back to [user.role].
    const roles: string[] = Array.isArray(user?.roles) ? user.roles : (user?.role ? [user.role] : []);

    if (!user || !roles.includes('superadmin')) {
      throw new ForbiddenException('SuperAdmin access required');
    }

    return true;
  }
}