import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SKIP_TENANT_KEY } from './skip-tenant.decorator';
import { TenantContext } from './tenant-context';
import { BranchValidatorService } from '../security/branch-validator.service';

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly branchValidator: BranchValidatorService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_TENANT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // Phase 2 of the multi-role migration — user.roles may be absent on a
    // JWT signed before this field existed, so fall back to [user.role].
    const roles: string[] = Array.isArray(user?.roles) ? user.roles : (user?.role ? [user.role] : []);

    if (roles.includes('superadmin')) {
      const superadminTenantId: string | null = request.headers['x-tenant-id'] ?? null;
      const branchId: string | null = request.headers['x-branch-id'] ?? null;
      request.tenantContext = new TenantContext(superadminTenantId, branchId);
      return true;
    }

    const tenantId: string | undefined = user?.tenant_id;

    if (!tenantId) {
      throw new ForbiddenException('Tenant context missing');
    }

    const branchId: string | null = request.headers['x-branch-id'] ?? null;

    if (branchId) {
      await this.branchValidator.validate(branchId, tenantId);
    }

    request.tenantContext = new TenantContext(tenantId, branchId);
    return true;
  }
}