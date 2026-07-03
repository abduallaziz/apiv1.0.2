import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SupabaseClient } from '@supabase/supabase-js';
import { NOTIFICATION_QUEUE, NOTIFICATION_PREFERENCE_KEYS } from './notification.constants';
import { SendNotificationDto } from './dto/send-notification.dto';
import { ChannelRegistry } from './channel-registry.service';
import { buildNotificationTemplate } from './templates/notification-templates';
import { NotificationType, NotificationChannel } from './notification.constants';
import { I18nService } from '../i18n/i18n.service';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';

export interface NotifyOptions {
  userId: string;
  tenantId?: string | null;
  type: NotificationType;
  channels: NotificationChannel[];
  recipientEmail?: string;
  data?: Record<string, unknown>;
  lang?: 'ar' | 'en';
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @InjectQueue(NOTIFICATION_QUEUE)
    private readonly queue: Queue,
    private readonly channelRegistry: ChannelRegistry,
    private readonly i18n: I18nService,
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  private async isEmailEnabled(tenantId: string, type: NotificationType): Promise<boolean> {
    const preferenceKey = NOTIFICATION_PREFERENCE_KEYS[type];
    if (!preferenceKey) return true; // security-critical types are always sent

    const { data, error } = await this.supabase
      .from('tenants')
      .select('notification_preferences')
      .eq('id', tenantId)
      .single();

    if (error || !data) return true;
    const preferences = (data.notification_preferences ?? {}) as Record<string, boolean>;
    return preferences[preferenceKey] !== false;
  }

  async notify(options: NotifyOptions): Promise<void> {
    let channels = options.channels;
    if (options.tenantId && channels.includes('email')) {
      const emailEnabled = await this.isEmailEnabled(options.tenantId, options.type);
      if (!emailEnabled) {
        channels = channels.filter((c) => c !== 'email');
      }
    }

    const jobs = channels.map((channel) => {
      const dto: SendNotificationDto = {
        userId: options.userId,
        tenantId: options.tenantId,
        type: options.type,
        channel,
        recipientEmail: options.recipientEmail,
        data: options.data,
        lang: options.lang,
      };

      return this.queue.add(`notify.${channel}`, dto, {
        jobId: `${options.userId}-${options.type}-${channel}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: true,
        removeOnFail: 50,
      });
    });

    await Promise.all(jobs);
  }

  async processJob(dto: SendNotificationDto): Promise<void> {
    const lang = this.i18n.resolveLanguage(dto.lang ?? null, null);
    const template = buildNotificationTemplate(dto.type, dto.data ?? {}, this.i18n, lang);

    const channel = this.channelRegistry.get(dto.channel);

    await channel.send({
      to: dto.channel === 'in_app' ? dto.userId : (dto.recipientEmail ?? dto.userId),
      title: template.title,
      body: template.body,
      data: {
        ...dto.data,
        tenantId: dto.tenantId,
        type: dto.type,
      },
    });
  }
}