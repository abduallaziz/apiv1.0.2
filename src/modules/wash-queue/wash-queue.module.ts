import { Module } from '@nestjs/common';
import { WashQueueController } from './wash-queue.controller';
import { WashQueueService } from './wash-queue.service';
import { WashQueueRepository } from './wash-queue.repository';
import { PermissionsModule } from '../../core/permissions/permissions.module';
import { CAR_READY_NOTIFIER } from './car-ready-notifier';
import { LogCarReadyNotifier } from './log-car-ready.notifier';

@Module({
  imports: [PermissionsModule],
  controllers: [WashQueueController],
  providers: [
    WashQueueService,
    WashQueueRepository,
    // Pluggable "car ready" channel (G9). Swap useClass for a real provider
    // (SMS/WhatsApp/push) once chosen; see the WASH-QUEUE section in STATUS.md.
    { provide: CAR_READY_NOTIFIER, useClass: LogCarReadyNotifier },
  ],
})
export class WashQueueModule {}
