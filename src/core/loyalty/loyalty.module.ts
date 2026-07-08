import { Module } from '@nestjs/common';
import { LoyaltyService } from './loyalty.service';
import { LoyaltyTiersRepository } from './loyalty-tiers.repository';
import { LoyaltyTiersController } from './loyalty-tiers.controller';
import { PermissionsModule } from '../permissions/permissions.module';
import { CoreAuthModule } from '../auth/auth.module';

@Module({
  imports: [PermissionsModule, CoreAuthModule],
  controllers: [LoyaltyTiersController],
  providers: [LoyaltyService, LoyaltyTiersRepository],
  exports: [LoyaltyService],
})
export class LoyaltyModule {}
