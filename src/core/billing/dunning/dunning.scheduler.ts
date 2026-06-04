import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DunningService } from './dunning.service';

@Injectable()
export class DunningScheduler {
  private readonly logger = new Logger(DunningScheduler.name);

  constructor(private readonly dunningService: DunningService) {}

  // كل ساعة — يتحقق من subscriptions فاشلة ويجدول dunning
  @Cron(CronExpression.EVERY_HOUR)
  async handleFailedPayments(): Promise<void> {
    this.logger.log('[CRON] processFailedPayments triggered');
    await this.dunningService.processFailedPayments();
  }

  // كل 30 دقيقة — يُعيد المحاولات المجدولة
  @Cron(CronExpression.EVERY_30_MINUTES)
  async handleRetries(): Promise<void> {
    this.logger.log('[CRON] retryPendingAttempts triggered');
    await this.dunningService.retryPendingAttempts();
  }

  // مرة يومياً الساعة 9 صباحاً — يُعلّق من تجاوز grace period
  @Cron('0 9 * * *')
  async handleGracePeriodExpiry(): Promise<void> {
    this.logger.log('[CRON] suspendExpiredGracePeriods triggered');
    await this.dunningService.suspendExpiredGracePeriods();
  }
}