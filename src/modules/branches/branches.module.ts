import { FeatureFlagsModule } from '../../core/feature-flags/feature-flags.module';
import { Module } from '@nestjs/common';
import { BranchesController } from './branches.controller';
import { BranchesService } from './branches.service';
import { BranchesRepository } from './branches.repository';
import { BillingModule } from '../../core/billing/billing.module';
import { RedisCacheService } from '../../core/cache/redis-cache.service';
import { BranchPublishRegistry } from './publish/branch-publish.registry';
import { BranchPublishService } from './publish/branch-publish.service';
import { BranchPublicationsRepository } from './publish/branch-publications.repository';
import { registerBuiltInPublishers } from './publish/publishers';

@Module({
  imports: [FeatureFlagsModule, BillingModule],
  controllers: [BranchesController],
  providers: [
    BranchesService,
    BranchesRepository,
    BranchPublicationsRepository,
    BranchPublishService,
    {
      provide: BranchPublishRegistry,
      inject: [RedisCacheService],
      useFactory: (cache: RedisCacheService) =>
        registerBuiltInPublishers(new BranchPublishRegistry(), cache),
    },
  ],
  exports: [BranchesService, BranchesRepository, BranchPublishService],
})
export class BranchesModule {}
