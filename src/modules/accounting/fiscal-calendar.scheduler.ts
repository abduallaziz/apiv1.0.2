import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { FiscalCalendarService } from './fiscal-calendar.service';

/**
 * WP-B — daily fiscal-year continuity pass.
 *
 * OFF by default (FISCAL_SCHEDULER_ENABLED=false). Even when enabled it only
 * REPORTS what it would create unless FISCAL_SCHEDULER_APPLY=true as well, so
 * turning the job on is a two-step, separately approved action. Fiscal years
 * are append-only, which is why "apply" is never the default.
 */
@Injectable()
export class FiscalCalendarScheduler {
  private readonly logger = new Logger(FiscalCalendarScheduler.name);

  constructor(
    private readonly fiscal: FiscalCalendarService,
    private readonly config: ConfigService,
  ) {}

  private flag(name: string): boolean {
    const v = this.config.get<string | boolean>(name);
    return v === true || v === 'true';
  }

  @Cron('0 3 * * *')
  async runDaily(): Promise<void> {
    if (!this.flag('FISCAL_SCHEDULER_ENABLED')) return;
    const apply = this.flag('FISCAL_SCHEDULER_APPLY');
    try {
      const report = await this.fiscal.runMaintenance({ apply });
      this.logger.log(
        `fiscal pass (${report.mode}): tenants=${report.tenants} to_create_years=${report.to_create_years} created=${report.created_years} refused=${report.refused} errors=${report.errors} alerts=${report.alerts.length}`,
      );
    } catch (err) {
      this.logger.error(
        `fiscal pass failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
