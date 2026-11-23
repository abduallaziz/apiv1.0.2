import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';
import { MetricsService } from '../../core/metrics/metrics.service';

/**
 * WP-E — retries the open financial exceptions (migration 335) so a transient stock failure that used to self-heal through the
 * post-commit retry still does once the sale path records instead of retrying.
 *
 * Runs ONLY when SALE_EXCEPTION_RECORDING_ENABLED is true (default false => this class does nothing). Bounded: at most
 * SALE_EXCEPTION_RETRY_MAX_TENANTS tenants per run and SALE_EXCEPTION_RETRY_BATCH_SIZE exceptions per tenant. A failing tenant
 * never stops the others. All the real work (idempotent deduction, COGS posted once, closed periods refused) is in SQL.
 */
@Injectable()
export class FinancialExceptionRetryScheduler {
  private readonly logger = new Logger(FinancialExceptionRetryScheduler.name);
  private running = false;

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
  ) {}

  private flag(name: string): boolean {
    const v = this.config.get<string | boolean>(name);
    return v === true || v === 'true';
  }

  private num(name: string, dflt: number, min: number, max: number): number {
    const n = Number(this.config.get(name));
    return Number.isFinite(n) && n >= min ? Math.min(n, max) : dflt;
  }

  @Cron('*/5 * * * *')
  async runBatch(): Promise<void> {
    if (!this.flag('SALE_EXCEPTION_RECORDING_ENABLED')) return;
    if (this.running) return; // never overlap with a previous, slower run
    this.running = true;
    try {
      const batch = this.num('SALE_EXCEPTION_RETRY_BATCH_SIZE', 50, 1, 500);
      const maxTenants = this.num('SALE_EXCEPTION_RETRY_MAX_TENANTS', 25, 1, 200);

      const { data, error } = await this.supabase
        .from('financial_exceptions')
        .select('tenant_id')
        .eq('status', 'open')
        .order('created_at', { ascending: true })
        .limit(maxTenants * batch);
      if (error) throw new Error(error.message);
      const tenants = [
        ...new Set((data ?? []).map((r: { tenant_id: string }) => r.tenant_id)),
      ].slice(0, maxTenants);

      for (const tenantId of tenants) {
        try {
          const res = await this.supabase.rpc('fn_financial_exception_retry_batch', {
            p_limit: batch,
            p_tenant_id: tenantId,
          });
          if (res.error) throw new Error(res.error.message);
          const counts = new Map<string, number>();
          for (const row of (res.data ?? []) as { status: string }[]) {
            counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
          }
          for (const [outcome, n] of counts) {
            this.metrics.recordFinancialExceptionRetry?.(outcome, n);
          }
          if (counts.size) {
            this.logger.log(
              `financial exception retry (tenant ${tenantId}): ${[...counts].map(([k, v]) => `${k}=${v}`).join(' ')}`,
            );
          }
        } catch (err) {
          // per-tenant isolation: record and continue with the next tenant
          this.metrics.recordFinancialExceptionRetry?.('error', 1);
          this.logger.error(
            `financial exception retry failed for tenant ${tenantId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } catch (err) {
      this.metrics.recordFinancialExceptionRetry?.('error', 1);
      this.logger.error(
        `financial exception retry run failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.running = false;
    }
  }
}
