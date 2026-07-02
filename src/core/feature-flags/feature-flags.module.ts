import { Module } from '@nestjs/common';
import { FeatureFlagsService } from './feature-flags.service';
import { FeatureGuard } from './feature.guard';

@Module({
  providers: [FeatureFlagsService, FeatureGuard],
  exports: [FeatureFlagsService, FeatureGuard],
})
export class FeatureFlagsModule {}