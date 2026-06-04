import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { NotificationService } from './notification.service';
import { NotificationProcessor } from './processors/notification.processor';
import { EmailChannel } from './channels/email.channel';
import { InAppChannel } from './channels/inapp.channel';
import { ChannelRegistry } from './channel-registry.service';
import { NotificationsRepository } from './repositories/notifications.repository';
import { NOTIFICATION_QUEUE } from './notification.constants';

@Module({
  imports: [
    BullModule.registerQueue({
      name: NOTIFICATION_QUEUE,
    }),
  ],
  providers: [
    ChannelRegistry,
    NotificationService,
    NotificationProcessor,
    EmailChannel,
    InAppChannel,
    NotificationsRepository,
  ],
  exports: [NotificationService, NotificationsRepository],
})
export class NotificationModule {}