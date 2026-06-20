import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationModule } from '../../core/notification/notification.module';
import { SecurityModule } from '../../core/security/security.module';

@Module({
  imports: [NotificationModule, SecurityModule],
  controllers: [NotificationsController],
})
export class NotificationsModule {}