import { Module } from '@nestjs/common';
import { TenantManagementRepository } from './tenant-management.repository';
import { LifecycleService } from './services/lifecycle.service';
import { FeatureService } from './services/feature.service';

@Module({
  providers: [TenantManagementRepository, LifecycleService, FeatureService],
  exports: [TenantManagementRepository, LifecycleService, FeatureService],
})
export class TenantManagementModule {}