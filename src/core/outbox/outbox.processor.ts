import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAMES } from '../queue/queue.constants';
import { OutboxRepository, DomainEventOutboxRow } from './outbox.repository';

@Processor(QUEUE_NAMES.DOMAIN_EVENTS)
export class OutboxProcessor extends WorkerHost {
  private readonly logger = new Logger(OutboxProcessor.name);

  constructor(private readonly outboxRepository: OutboxRepository) {
    super();
  }

  async process(job: Job<DomainEventOutboxRow>): Promise<void> {
    const event = job.data;

    try {
      await this.relay(event);
      await this.outboxRepository.markProcessed(event.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to relay domain event ${event.id} (${event.event_type}): ${message}`,
      );
      await this.outboxRepository.markFailed(event.id, event.retry_count, message);
      throw error;
    }
  }

  // نقطة التوسعة الوحيدة لربط مستهلكين فعليين (إشعارات، فهرسة بحث، تحليلات...) بنوع الحدث
  private async relay(event: DomainEventOutboxRow): Promise<void> {
    this.logger.log(
      `Relaying domain event: ${event.event_type} (aggregate=${event.aggregate_type}:${event.aggregate_id}, tenant=${event.tenant_id})`,
    );
  }
}
