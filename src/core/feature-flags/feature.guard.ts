import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRE_FEATURE_KEY } from './require-feature.decorator';
import { FeatureFlagsService } from './feature-flags.service';

@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly featureFlagsService: FeatureFlagsService,
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

    const isEnabled = await this.featureFlagsService.resolveFeature(tenantId, featureKey);

    if (!isEnabled) {
      throw new ForbiddenException(`Feature '${featureKey}' is not available for your plan`);
    }

    return true;
  }
}