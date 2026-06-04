import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChannelRegistry } from '../channel-registry.service';
import {
  INotificationChannel,
  NotificationPayload,
} from './notification-channel.interface';

@Injectable()
export class EmailChannel implements INotificationChannel, OnModuleInit {
  readonly channelName = 'email';
  private readonly logger = new Logger(EmailChannel.name);
  private resend: any;

  constructor(
    private readonly config: ConfigService,
    private readonly registry: ChannelRegistry,
  ) {}

  onModuleInit(): void {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    if (apiKey) {
      import('resend')
        .then(({ Resend }) => {
          this.resend = new Resend(apiKey);
          this.logger.log('Resend client initialized');
        })
        .catch(() => {
          this.logger.warn('Resend package failed to load — mock mode active');
        });
    } else {
      this.logger.warn('RESEND_API_KEY not set — email mock mode active');
    }
    this.registry.register(this);
  }

  async send(payload: NotificationPayload): Promise<void> {
    if (!this.resend) {
      this.logger.debug(
        `[MOCK EMAIL] To: ${payload.to} | Subject: ${payload.title}`,
      );
      return;
    }

    const from = this.config.get<string>(
      'NOTIFICATION_FROM_EMAIL',
      'notifications@sefay.com',
    );

    try {
      await this.resend.emails.send({
        from,
        to: payload.to,
        subject: payload.title,
        html: this.buildHtml(payload),
      });
      this.logger.debug(`Email sent to ${payload.to}`);
    } catch (error) {
      this.logger.error(`Failed to send email to ${payload.to}`, error);
      throw error;
    }
  }

  private buildHtml(payload: NotificationPayload): string {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; background: #f4f4f4; margin: 0; padding: 0; }
            .container { max-width: 600px; margin: 40px auto; background: #fff; border-radius: 8px; padding: 32px; }
            .header { color: #0f1117; font-size: 20px; font-weight: bold; margin-bottom: 16px; }
            .body { color: #444; font-size: 15px; line-height: 1.6; }
            .footer { margin-top: 32px; font-size: 12px; color: #999; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">Sefay — ${payload.title}</div>
            <div class="body">${payload.body}</div>
            <div class="footer">هذا البريد أُرسل تلقائياً — لا ترد على هذا العنوان.</div>
          </div>
        </body>
      </html>
    `;
  }
}