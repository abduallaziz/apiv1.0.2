import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { OutboxRepository } from './outbox.repository';
import { OutboxRelayScheduler } from './outbox-relay.scheduler';
import { OutboxProcessor } from './outbox.processor';

@Module({
  imports: [QueueModule],
  providers: [OutboxRepository, OutboxRelayScheduler, OutboxProcessor],
})
export class OutboxModule {}
