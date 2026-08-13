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
import { resolveUserPermission } from './permission-resolution.util';
import { JwtPayload } from '../../shared/types/jwt-payload.type';

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

    const request = context.switchToHttp().getRequest<{ user?: JwtPayload }>();
    const user = request.user;

    // Decision logic (bypass rules, legacy/hybrid shadow comparison) lives
    // in resolveUserPermission — the single source of truth this guard
    // shares with ActionExecutorService (#21 Phase 7 authorization patch),
    // so there is exactly one place "is this user allowed X" is decided.
    const granted = await resolveUserPermission(
      this.permissionsService,
      this.logger,
      user,
      requiredPermission,
    );

    if (!granted) {
      throw new ForbiddenException(`Permission denied: ${requiredPermission}`);
    }

    return true;
  }
}
