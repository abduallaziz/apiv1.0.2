import { FeatureFlagsModule } from '../../core/feature-flags/feature-flags.module';
import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { PermissionsModule } from '../../core/permissions/permissions.module';

@Module({
  imports: [FeatureFlagsModule, PermissionsModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
