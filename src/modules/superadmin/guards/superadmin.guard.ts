import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { isPlatformAdmin } from '../../../core/security/platform-identity';

@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // R-01: platform identity, not a role name (see core/security/platform-identity).
    if (!user || !isPlatformAdmin(user)) {
      throw new ForbiddenException('SuperAdmin access required');
    }

    return true;
  }
}
