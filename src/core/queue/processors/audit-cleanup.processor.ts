import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Inject } from '@nestjs/common';
import { Job } from 'bullmq';
import { SupabaseClient } from '@supabase/supabase-js';
import { QUEUE_NAMES } from '../queue.constants';
import { SUPABASE_CLIENT } from '../../../shared/supabase/supabase.module';

export const AUDIT_CLEANUP_JOB = 'cleanup-old-audit-logs';
export const AUDIT_RETENTION_DAYS = 90;

@Processor(QUEUE_NAMES.AUDIT_CLEANUP)
export class AuditCleanupProcessor extends WorkerHost {
  private readonly logger = new Logger(AuditCleanupProcessor.name);

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {
    super();
  }

  async process(job: Job, token?: string): Promise<void> {
    if (job.name !== AUDIT_CLEANUP_JOB) {
      this.logger.warn(`Unknown audit cleanup job: ${job.name}`);
      return;
    }

    this.logger.log(`Starting audit log cleanup (retention: ${AUDIT_RETENTION_DAYS} days)`);

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - AUDIT_RETENTION_DAYS);

    const { error, count } = await this.supabase
      .from('audit_logs')
      .delete({ count: 'exact' })
      .lt('created_at', cutoffDate.toISOString());

    if (error) {
      this.logger.error(`Audit cleanup failed: ${error.message}`);
      throw error;
    }

    if (count === null) {
      this.logger.warn('Cleanup completed but row count not returned');
    } else {
      this.logger.log(`Audit cleanup completed: removed ${count} records`);
    }
  }
}