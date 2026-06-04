import {
  IsString,
  IsEnum,
  IsOptional,
  IsUUID,
  IsObject,
} from 'class-validator';
import {
  NotificationChannel,
  NotificationType,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TYPES,
} from '../notification.constants';

export class SendNotificationDto {
  @IsUUID()
  userId: string;

  @IsOptional()
  @IsUUID()
  tenantId?: string | null;

  @IsEnum(Object.values(NOTIFICATION_TYPES))
  type: NotificationType;

  @IsEnum(Object.values(NOTIFICATION_CHANNELS))
  channel: NotificationChannel;

  @IsOptional()
  @IsString()
  recipientEmail?: string;

  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;

  @IsOptional()
  @IsEnum(['ar', 'en'])
  lang?: 'ar' | 'en';
}