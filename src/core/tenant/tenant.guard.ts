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
import { TenantIsolationService } from '../security/tenant-isolation.service';
import { EntitlementsService } from '../security/entitlements.service';
import { isPlatformAdmin } from '../security/platform-identity';

interface GuardUser {
  tenant_id?: string;
  branch_id?: string | null;
  role?: string;
  roles?: string[];
}

interface GuardRequest {
  user?: GuardUser;
  headers: Record<string, string | undefined>;
  originalUrl?: string;
  url?: string;
  tenantContext?: TenantContext;
}

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly branchValidator: BranchValidatorService,
    private readonly isolation: TenantIsolationService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_TENANT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    const request = context.switchToHttp().getRequest<GuardRequest>();
    const user = request.user;

    // R-01: "platform" is decided by isPlatformAdmin() (tenant-less identity
    // holding the GLOBAL superadmin role), never by a role name in the token
    // — a tenant can create a role with any name.
    if (isPlatformAdmin(user)) {
      const superadminTenantId: string | null =
        request.headers['x-tenant-id'] ?? null;
      const branchId: string | null = request.headers['x-branch-id'] ?? null;
      request.tenantContext = new TenantContext(superadminTenantId, branchId);
      return true;
    }

    const tenantId: string | undefined = user?.tenant_id;

    if (!tenantId) {
      throw new ForbiddenException('Tenant context missing');
    }

    const headerBranchId: string | null =
      request.headers['x-branch-id'] ?? null;
    const ownBranchId: string | null = user?.branch_id ?? null;
    // Plan ended => the tenant is fully suspended (402). Behind SUBSCRIPTION_ENFORCEMENT, off by default.
    await this.entitlements.assertAccess(
      tenantId,
      request.originalUrl ?? request.url ?? '',
    );
    const iso = await this.isolation.get(tenantId);

    let branchId: string | null;
    if (ownBranchId) {
      // Branch-restricted user: the branch is THEIR branch. A header naming another branch is a hard
      // reject (it used to be accepted as long as the branch existed in the tenant).
      if (headerBranchId && headerBranchId !== ownBranchId) {
        throw new ForbiddenException(
          'You are not authorized to access this branch.',
        );
      }
      branchId = ownBranchId;
    } else if (headerBranchId) {
      // Central user (owner/admin) choosing a working branch.
      if (!(await this.isolation.isActiveBranch(tenantId, headerBranchId))) {
        // Same answer as before (and same message) for an unknown / inactive / foreign branch.
        await this.branchValidator.validate(headerBranchId, tenantId);
      }
      branchId = headerBranchId;
    } else {
      // Central user without a chosen branch: tenant-wide, except under isolation where the default
      // scope is the main branch.
      branchId = iso.enabled ? iso.mainBranchId : null;
    }

    request.tenantContext = new TenantContext(tenantId, branchId, iso.enabled);
    return true;
  }
}
