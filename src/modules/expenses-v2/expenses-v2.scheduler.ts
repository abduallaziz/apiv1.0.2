import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ExpensesV2Service } from './expenses-v2.service';

// Step 6 — Recurring generation job. Runs once daily; a missed/paused run
// loses no data since it only ever creates new Expenses forward from
// `next_occurrence_date`, never mutating or backfilling past ones.
@Injectable()
export class ExpensesV2Scheduler {
  private readonly logger = new Logger(ExpensesV2Scheduler.name);

  constructor(private readonly expensesV2Service: ExpensesV2Service) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleRecurringExpenses() {
    const { created, failed } =
      await this.expensesV2Service.generateDueRecurringExpenses();
    if (created > 0 || failed > 0) {
      this.logger.log(
        `Recurring Expense generation: ${created} created, ${failed} failed`,
      );
    }
  }
}
