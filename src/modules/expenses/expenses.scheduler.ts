import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ExpensesService } from './expenses.service';

@Injectable()
export class ExpensesScheduler {
  private readonly logger = new Logger(ExpensesScheduler.name);

  constructor(private readonly expensesService: ExpensesService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleExpiredExpenses() {
    const count = await this.expensesService.expireStaleExpenses();
    if (count > 0) {
      this.logger.log(`Expired ${count} stale expense requests`);
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleRecurringExpenses() {
    const count = await this.expensesService.processRecurringExpenses();
    if (count > 0) {
      this.logger.log(`Created ${count} expense(s) from recurring templates`);
    }
  }
}