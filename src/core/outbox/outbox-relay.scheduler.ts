import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_NAMES } from '../queue/queue.constants';
import { OutboxRepository } from './outbox.repository';

const CLAIM_BATCH_SIZE = 50;

@Injectable()
export class OutboxRelayScheduler {
  private readonly logger = new Logger(OutboxRelayScheduler.name);
  private isRunning = false;

  constructor(
    private readonly outboxRepository: OutboxRepository,
    @InjectQueue(QUEUE_NAMES.DOMAIN_EVENTS) private readonly domainEventsQueue: Queue,
  ) {}

  // كل 15 ثانية: يلتقط الأحداث المعلقة من صندوق الصادر ويضعها في طابور المعالجة
  @Cron('*/15 * * * * *')
  async handleRelay(): Promise<void> {
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;
    try {
      const claimed = await this.outboxRepository.claimBatch(CLAIM_BATCH_SIZE);
      if (claimed.length === 0) {
        return;
      }

      this.logger.log(`Claimed ${claimed.length} outbox event(s) for relay`);

      await Promise.all(
        claimed.map((event) =>
          this.domainEventsQueue.add(event.event_type, event, {
            jobId: event.id,
            attempts: 1,
          }),
        ),
      );
    } catch (error) {
      this.logger.error(
        `Outbox relay sweep failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.isRunning = false;
    }
  }
}
