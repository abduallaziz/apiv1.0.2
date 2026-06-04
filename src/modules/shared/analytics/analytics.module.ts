import { Module } from '@nestjs/common';
import { PlatformAnalyticsRepository } from './platform-analytics.repository';
import { AnalyticsService } from './analytics.service';

@Module({
  providers: [PlatformAnalyticsRepository, AnalyticsService],
  exports: [PlatformAnalyticsRepository, AnalyticsService],
})
export class AnalyticsModule {}