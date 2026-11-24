import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';
import { MetricsService } from '../../core/metrics/metrics.service';

/**
 * WP-B — fiscal-year continuity.
 *
 * Every tenant has exactly one fiscal year unless something generates the next
 * one; without it posting fails on the first date after the last period. This
 * service drives the database functions of migration 325
 * (fn_plan_fiscal_years / fn_ensure_fiscal_years / v_fiscal_coverage /
 * fn_fiscal_coverage_alerts). Fiscal years are APPEND-ONLY, so:
 *   - everything is dry-run unless `apply` is explicitly true;
 *   - the horizon is bounded (default 2 years, hard cap 5);
 *   - nothing here ever updates or deletes a fiscal year/period.
 */
export interface FiscalPlanRow {
  seq: number;
  action: 'create' | 'covered' | 'refuse';
  year_label: string | null;
  start_date: string | null;
  end_date: string | null;
  created?: boolean;
  detail: string;
}

export interface FiscalTenantReport {
  tenant_id: string;
  through_date: string;
  rows: FiscalPlanRow[];
  created: number;
  error?: string;
}

export interface FiscalAlert {
  tenant_id: string;
  covered_until: string;
  days_remaining: number;
  severity: string;
}

export interface FiscalMaintenanceReport {
  mode: 'dry-run' | 'apply';
  through_date: string;
  tenants: number;
  to_create_years: number;
  to_create_periods: number;
  created_years: number;
  refused: number;
  errors: number;
  alerts: FiscalAlert[];
  per_tenant: FiscalTenantReport[];
}

export interface FiscalSettings {
  horizonYears: number;
  alertDays: number;
}

@Injectable()
export class FiscalCalendarService {
  private readonly logger = new Logger(FiscalCalendarService.name);

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
    private readonly config: ConfigService,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  getSettings(): FiscalSettings {
    const horizon = Number(this.config.get('FISCAL_HORIZON_YEARS') ?? 2);
    const alert = Number(this.config.get('FISCAL_ALERT_DAYS') ?? 180);
    return {
      horizonYears: Number.isFinite(horizon)
        ? Math.min(Math.max(Math.trunc(horizon), 0), 5)
        : 2,
      alertDays: Number.isFinite(alert) ? Math.max(Math.trunc(alert), 1) : 180,
    };
  }

  /** Date `years` ahead of `from` (UTC calendar date, YYYY-MM-DD). */
  static throughDate(from: Date, years: number): string {
    const d = new Date(
      Date.UTC(
        from.getUTCFullYear() + years,
        from.getUTCMonth(),
        from.getUTCDate(),
      ),
    );
    return d.toISOString().slice(0, 10);
  }

  async plan(tenantId: string, throughDate: string): Promise<FiscalPlanRow[]> {
    const { data, error } = await this.supabase.rpc('fn_plan_fiscal_years', {
      p_tenant_id: tenantId,
      p_through_date: throughDate,
    });
    if (error) throw new Error(error.message);
    return (data ?? []) as FiscalPlanRow[];
  }

  async ensure(
    tenantId: string,
    throughDate: string,
    dryRun: boolean,
  ): Promise<FiscalPlanRow[]> {
    const { data, error } = await this.supabase.rpc('fn_ensure_fiscal_years', {
      p_tenant_id: tenantId,
      p_through_date: throughDate,
      p_dry_run: dryRun,
    });
    if (error) throw new Error(error.message);
    return (data ?? []) as FiscalPlanRow[];
  }

  async alerts(thresholdDays?: number): Promise<FiscalAlert[]> {
    const { data, error } = await this.supabase.rpc(
      'fn_fiscal_coverage_alerts',
      { p_threshold_days: thresholdDays ?? this.getSettings().alertDays },
    );
    if (error) throw new Error(error.message);
    return (data ?? []) as FiscalAlert[];
  }

  private async tenantsWithCalendar(): Promise<string[]> {
    const { data, error } = await this.supabase
      .from('v_fiscal_coverage')
      .select('tenant_id');
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: { tenant_id: string }) => r.tenant_id);
  }

  /**
   * One maintenance pass over every tenant. `apply=false` (the default) only
   * reports what would be created. A failure for one tenant never stops the
   * others. Coverage alerts are logged (error level when critical/expired) and
   * exported as aggregate gauges (no tenant labels).
   */
  async runMaintenance(
    opts: { apply?: boolean; now?: Date } = {},
  ): Promise<FiscalMaintenanceReport> {
    const apply = opts.apply === true;
    const { horizonYears } = this.getSettings();
    const through = FiscalCalendarService.throughDate(
      opts.now ?? new Date(),
      horizonYears,
    );
    const report: FiscalMaintenanceReport = {
      mode: apply ? 'apply' : 'dry-run',
      through_date: through,
      tenants: 0,
      to_create_years: 0,
      to_create_periods: 0,
      created_years: 0,
      refused: 0,
      errors: 0,
      alerts: [],
      per_tenant: [],
    };

    const tenantIds = await this.tenantsWithCalendar();
    report.tenants = tenantIds.length;

    for (const tenantId of tenantIds) {
      const entry: FiscalTenantReport = {
        tenant_id: tenantId,
        through_date: through,
        rows: [],
        created: 0,
      };
      try {
        const rows = apply
          ? await this.ensure(tenantId, through, false)
          : await this.plan(tenantId, through);
        entry.rows = rows;
        const toCreate = rows.filter((r) => r.action === 'create').length;
        report.to_create_years += toCreate;
        report.to_create_periods += toCreate * 12;
        const refusal = rows.find((r) => r.action === 'refuse');
        if (refusal) {
          report.refused += 1;
          this.logger.warn(
            `fiscal years refused for tenant ${tenantId}: ${refusal.detail}`,
          );
        }
        entry.created = rows.filter((r) => r.created).length;
        report.created_years += entry.created;
      } catch (err) {
        report.errors += 1;
        entry.error = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `fiscal year maintenance failed for tenant ${tenantId}: ${entry.error}`,
        );
      }
      report.per_tenant.push(entry);
    }

    try {
      report.alerts = await this.alerts();
    } catch (err) {
      report.errors += 1;
      this.logger.error(
        `fiscal coverage alert query failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    this.publish(report);
    return report;
  }

  private publish(report: FiscalMaintenanceReport): void {
    const critical = report.alerts.filter(
      (a) => a.severity === 'critical' || a.severity === 'expired',
    );
    for (const a of critical) {
      this.logger.error(
        `FISCAL COVERAGE ${a.severity.toUpperCase()}: tenant ${a.tenant_id} covered until ${a.covered_until} (${a.days_remaining} days)`,
      );
    }
    if (report.alerts.length > critical.length) {
      this.logger.warn(
        `${report.alerts.length - critical.length} tenant(s) below the fiscal coverage threshold`,
      );
    }
    this.metrics?.setFiscalCoverage(
      report.alerts.length
        ? Math.min(...report.alerts.map((a) => a.days_remaining))
        : this.getSettings().alertDays,
      report.alerts.length,
    );
  }
}
