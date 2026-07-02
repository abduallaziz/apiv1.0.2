import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_NAMES } from '../queue.constants';
import { AUDIT_CLEANUP_JOB } from './audit-cleanup.processor';

@Injectable()
export class AuditCleanupScheduler {
  private readonly logger = new Logger(AuditCleanupScheduler.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.AUDIT_CLEANUP)
    private readonly auditCleanupQueue: Queue,
  ) {}

  // كل يوم أحد الساعة 2 صباحاً
  @Cron('0 2 * * 0')
  async handleWeeklyCleanup(): Promise<void> {
    this.logger.log('[CRON] Queuing audit log cleanup job');
    await this.auditCleanupQueue.add(AUDIT_CLEANUP_JOB, {}, {
      jobId: `audit-cleanup-${Date.now()}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });
  }
}