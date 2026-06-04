import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../../shared/supabase/supabase.module';
import { ChannelRegistry } from '../channel-registry.service';
import {
  INotificationChannel,
  NotificationPayload,
} from './notification-channel.interface';

@Injectable()
export class InAppChannel implements INotificationChannel, OnModuleInit {
  readonly channelName = 'in_app';
  private readonly logger = new Logger(InAppChannel.name);

  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: SupabaseClient,
    private readonly registry: ChannelRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async send(payload: NotificationPayload): Promise<void> {
    const { error } = await this.supabase.from('notifications').insert({
      user_id: payload.to,
      tenant_id: payload.data?.tenantId ?? null,
      type: payload.data?.type ?? 'general',
      title: payload.title,
      body: payload.body,
      data: payload.data ?? null,
      channel: this.channelName,
    });

    if (error) {
      this.logger.error(`Failed to save in-app notification for user ${payload.to}`, error);
      throw error;
    }

    this.logger.debug(`In-app notification saved for user: ${payload.to}`);
  }
}