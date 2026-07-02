import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_NAMES } from '../queue.constants';
import { PLATFORM_ANALYTICS_JOB_REFRESH } from './platform-analytics.processor';

@Injectable()
export class PlatformAnalyticsScheduler {
  private readonly logger = new Logger(PlatformAnalyticsScheduler.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.ANALYTICS)
    private readonly analyticsQueue: Queue,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleRefresh(): Promise<void> {
    this.logger.log('[CRON] Queuing platform analytics refresh job');
    await this.analyticsQueue.add(
      PLATFORM_ANALYTICS_JOB_REFRESH,
      {},
      {
        jobId: `platform-analytics-refresh-${Date.now()}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    );
  }
}
