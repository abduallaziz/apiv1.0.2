import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationModule } from '../../core/notification/notification.module';

@Module({
  imports: [NotificationModule],
  controllers: [NotificationsController],
})
export class NotificationsModule {}