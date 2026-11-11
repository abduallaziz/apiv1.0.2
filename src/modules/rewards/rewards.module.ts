import { Module } from '@nestjs/common';
import { RewardDefinitionsController } from './reward-definitions.controller';
import { CustomerRewardsController } from './customer-rewards.controller';
import { RewardDefinitionsService } from './reward-definitions.service';
import { RewardDefinitionsRepository } from './reward-definitions.repository';
import { RewardInstancesRepository } from './reward-instances.repository';
import { RewardEligibilityService } from './reward-eligibility.service';
import { RewardRedemptionService } from './reward-redemption.service';
import { RewardExpirationScheduler } from './reward-expiration.scheduler';
import { DiscountEngineModule } from '../../engines/discount-engine/discount-engine.module';
import { CouponsModule } from '../coupons/coupons.module';
import { PermissionsModule } from '../../core/permissions/permissions.module';
import { CoreAuthModule } from '../../core/auth/auth.module';

@Module({
  imports: [
    PermissionsModule,
    CoreAuthModule,
    DiscountEngineModule,
    CouponsModule,
  ],
  controllers: [RewardDefinitionsController, CustomerRewardsController],
  providers: [
    RewardDefinitionsService,
    RewardDefinitionsRepository,
    RewardInstancesRepository,
    RewardEligibilityService,
    RewardRedemptionService,
    RewardExpirationScheduler,
  ],
  exports: [
    RewardDefinitionsRepository,
    RewardInstancesRepository,
    RewardEligibilityService,
    RewardRedemptionService,
  ],
})
export class RewardsModule {}
