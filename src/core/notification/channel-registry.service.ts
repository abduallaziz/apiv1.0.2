import { Injectable, Logger } from '@nestjs/common';
import { INotificationChannel } from './channels/notification-channel.interface';

@Injectable()
export class ChannelRegistry {
  private readonly logger = new Logger(ChannelRegistry.name);
  private readonly channels = new Map<string, INotificationChannel>();

  register(channel: INotificationChannel): void {
    this.channels.set(channel.channelName, channel);
    this.logger.debug(`Channel registered: ${channel.channelName}`);
  }

  get(name: string): INotificationChannel {
    const channel = this.channels.get(name);
    if (!channel) {
      throw new Error(`Notification channel "${name}" not registered`);
    }
    return channel;
  }

  has(name: string): boolean {
    return this.channels.has(name);
  }

  getAll(): string[] {
    return Array.from(this.channels.keys());
  }
}