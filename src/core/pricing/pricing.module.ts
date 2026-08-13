import { Global, Module } from '@nestjs/common';
import { EffectiveRoleResolver } from './effective-role.resolver';
import { PriceResolutionService } from './price-resolution.service';

// D01-M5 (EffectiveRoleResolver) + D01-M6 (PriceResolutionService). Mirrors
// PermissionsModule's shape (Global). PriceResolutionService depends on
// PermissionsService (injected via PermissionsModule's @Global export, not
// re-imported here) and EffectiveRoleResolver — no role/permission logic is
// duplicated in this module.
@Global()
@Module({
  providers: [EffectiveRoleResolver, PriceResolutionService],
  exports: [EffectiveRoleResolver, PriceResolutionService],
})
export class PricingModule {}
