import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAMES } from '../queue.constants';
import { RedisCacheService } from '../../cache/redis-cache.service';
import { PlatformAnalyticsRepository } from '../../../modules/shared/analytics/platform-analytics.repository';
import {
  WARMED_USAGE_PERIODS,
  COHORT_ANALYSIS_CACHE_KEY,
  WARMED_CACHE_TTL_SECONDS,
  buildUsageAnalyticsCacheKey,
} from '../../../modules/shared/analytics/platform-analytics-cache.keys';

export const PLATFORM_ANALYTICS_JOB_REFRESH = 'platform-analytics.refresh';

/**
 * Recomputes the expensive platform-wide analytics (usage + cohort) off the
 * request path and warms the Redis cache. Runs hourly via PlatformAnalyticsScheduler
 * so getUsageAnalytics/getCohortAnalysis never trigger a live computation under
 * normal load, regardless of tenant count.
 */
@Processor(QUEUE_NAMES.ANALYTICS)
export class PlatformAnalyticsProcessor extends WorkerHost {
  private readonly logger = new Logger(PlatformAnalyticsProcessor.name);

  constructor(
    private readonly repo: PlatformAnalyticsRepository,
    private readonly cache: RedisCacheService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== PLATFORM_ANALYTICS_JOB_REFRESH) {
      this.logger.warn(`Unknown analytics job: ${job.name}`);
      return;
    }

    const cohort = await this.repo.getCohortAnalysis();
    await this.cache.set(COHORT_ANALYSIS_CACHE_KEY, cohort, WARMED_CACHE_TTL_SECONDS);

    for (const period of WARMED_USAGE_PERIODS) {
      const usage = await this.repo.getUsageAnalytics(period);
      await this.cache.set(
        buildUsageAnalyticsCacheKey(period),
        usage,
        WARMED_CACHE_TTL_SECONDS,
      );
    }

    this.logger.log('Platform analytics cache refreshed');
  }
}
