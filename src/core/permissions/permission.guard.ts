import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsService } from './permissions.service';
import { REQUIRE_PERMISSION_KEY } from './require-permission.decorator';

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