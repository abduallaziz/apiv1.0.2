import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRE_FEATURE_KEY } from './require-feature.decorator';
import { EntitlementsService } from '../security/entitlements.service';

/**
 * Blocks a route whose @RequireFeature('key') is NOT part of the tenant's entitlements
 * (plan features + active feature add-ons, after super-admin overrides).
 *
 * Only enforced when SUBSCRIPTION_ENFORCEMENT is on for the tenant; otherwise everything is allowed,
 * so turning the flag off is a complete and instant disable. Super admins always bypass.
 */
@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly entitlements: EntitlementsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const featureKey = this.reflector.getAllAndOverride<string>(
      REQUIRE_FEATURE_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No @RequireFeature → allow
    if (!featureKey) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // Superadmin bypasses feature flags
    if (user?.role === 'superadmin') return true;

    const tenantId: string | undefined = request.tenantContext?.tenantId;

    if (!tenantId) {
      throw new ForbiddenException('Tenant context missing');
    }

    const ent = await this.entitlements.get(tenantId);
    // Enforcement off for this tenant → no feature gating at all.
    if (!ent.enforced) return true;
    if (!ent.features.includes(featureKey)) {
      throw new ForbiddenException(
        `Feature '${featureKey}' is not available for your plan`,
      );
    }

    return true;
  }
}
