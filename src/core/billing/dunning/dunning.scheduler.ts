import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_NAMES } from '../../queue/queue.constants';
import {
  DUNNING_JOB_PROCESS_FAILED,
  DUNNING_JOB_RETRY_PENDING,
  DUNNING_JOB_SUSPEND_EXPIRED,
} from '../../queue/processors/dunning.processor';

@Injectable()
export class DunningScheduler {
  private readonly logger = new Logger(DunningScheduler.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.DUNNING)
    private readonly dunningQueue: Queue,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleFailedPayments(): Promise<void> {
    this.logger.log('[CRON] Queuing processFailedPayments job');
    await this.dunningQueue.add(DUNNING_JOB_PROCESS_FAILED, {}, {
      jobId: `process-failed-${Date.now()}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });
  }

  @Cron(CronExpression.EVERY_30_MINUTES)
  async handleRetries(): Promise<void> {
    this.logger.log('[CRON] Queuing retryPendingAttempts job');
    await this.dunningQueue.add(DUNNING_JOB_RETRY_PENDING, {}, {
      jobId: `retry-pending-${Date.now()}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });
  }

  @Cron('0 9 * * *')
  async handleGracePeriodExpiry(): Promise<void> {
    this.logger.log('[CRON] Queuing suspendExpiredGracePeriods job');
    await this.dunningQueue.add(DUNNING_JOB_SUSPEND_EXPIRED, {}, {
      jobId: `suspend-expired-${Date.now()}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });
  }
}