import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAMES } from '../queue.constants';
import { DunningService } from '../../billing/dunning/dunning.service';

export const DUNNING_JOB_PROCESS_FAILED = 'process-failed-payments';
export const DUNNING_JOB_RETRY_PENDING = 'retry-pending-attempts';
export const DUNNING_JOB_SUSPEND_EXPIRED = 'suspend-expired-grace';

@Processor(QUEUE_NAMES.DUNNING)
export class DunningProcessor extends WorkerHost {
  private readonly logger = new Logger(DunningProcessor.name);

  constructor(private readonly dunningService: DunningService) {
    super();
  }

  async process(job: Job, token?: string): Promise<void> {
    this.logger.log(`Processing dunning job: ${job.name} [${job.id}]`);

    switch (job.name) {
      case DUNNING_JOB_PROCESS_FAILED:
        await this.dunningService.processFailedPayments();
        break;
      case DUNNING_JOB_RETRY_PENDING:
        await this.dunningService.retryPendingAttempts();
        break;
      case DUNNING_JOB_SUSPEND_EXPIRED:
        await this.dunningService.suspendExpiredGracePeriods();
        break;
      default:
        this.logger.warn(`Unknown dunning job: ${job.name}`);
    }

    this.logger.log(`Dunning job completed: ${job.name} [${job.id}]`);
  }
}