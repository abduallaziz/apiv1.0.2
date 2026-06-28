import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { QUEUE_NAMES } from './queue.constants';
import { QueueRegistry } from './queue.registry';
import { QueueService } from './queue.service';
import { QueueExistsPipe } from './pipes/queue-exists.pipe';
import { DunningProcessor } from './processors/dunning.processor';
import { AuditCleanupProcessor } from './processors/audit-cleanup.processor';
import { AuditCleanupScheduler } from './processors/audit-cleanup.scheduler';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const redisUrl = config.get<string>('REDIS_URL');
        const appEnv = config.get<string>('APP_ENV', 'production');
        const prefix = appEnv === 'staging' ? 'sefay-staging' : 'sefay';
        return {
          prefix,
          connection: redisUrl
            ? { url: redisUrl }
            : {
                host: config.get<string>('REDIS_HOST', 'localhost'),
                port: config.get<number>('REDIS_PORT', 6379),
                password: config.get<string>('REDIS_PASSWORD') || undefined,
              },
          defaultJobOptions: {
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: { count: 100 },
            removeOnFail: { count: 50 },
          },
        };
      },
    }),
    BullModule.registerQueue(
      { name: QUEUE_NAMES.DUNNING },
      { name: QUEUE_NAMES.AUDIT_CLEANUP },
      { name: QUEUE_NAMES.NOTIFICATIONS },
      { name: QUEUE_NAMES.DOMAIN_EVENTS },
    ),
    BillingModule,
  ],
  providers: [
    QueueRegistry,
    QueueService,
    QueueExistsPipe,
    DunningProcessor,
    AuditCleanupProcessor,
    AuditCleanupScheduler,
  ],
  exports: [BullModule, QueueRegistry, QueueService, QueueExistsPipe],
})
export class QueueModule {}