import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  Registry,
  Histogram,
  Counter,
  Gauge,
  collectDefaultMetrics,
} from 'prom-client';
import {
  HTTP_REQUEST_DURATION_MS,
  HTTP_REQUESTS_TOTAL,
  HTTP_ACTIVE_REQUESTS,
  BUSINESS_INVOICES_TOTAL,
  BUSINESS_SHIFTS_TOTAL,
  BUSINESS_EXPENSES_TOTAL,
  BUSINESS_ACTIVE_TENANTS,
  FISCAL_COVERAGE_DAYS_MIN,
  FISCAL_COVERAGE_TENANTS_BELOW_THRESHOLD,
  POOLED_SALES_GUARD_VIOLATION,
  UNPOOLED_SALE_ATTEMPTS_TOTAL,
  FINANCIAL_EXCEPTIONS_RECORDED_TOTAL,
} from './metrics.constants';

@Injectable()
export class MetricsService implements OnModuleInit {
  private readonly registry: Registry;

  readonly httpRequestDuration: Histogram<string>;
  readonly httpRequestsTotal: Counter<string>;
  readonly httpActiveRequests: Gauge<string>;

  readonly invoicesTotal: Counter<string>;
  readonly shiftsTotal: Counter<string>;
  readonly expensesTotal: Counter<string>;
  readonly activeTenantsGauge: Gauge<string>;
  // WP-B: aggregate only (no tenant labels — /metrics is not tenant-scoped).
  readonly fiscalCoverageDaysMin: Gauge<string>;
  readonly fiscalTenantsBelowThreshold: Gauge<string>;
  // R-UNPOOLED: 1 per active violation reason (no tenant labels).
  readonly pooledSalesGuardViolation: Gauge<string>;
  readonly unpooledSaleAttempts: Counter<string>;
  readonly financialExceptionsRecorded: Counter<string>;

  constructor() {
    this.registry = new Registry();
    this.registry.setDefaultLabels({ app: 'sefay-api' });

    this.httpRequestDuration = new Histogram({
      name: HTTP_REQUEST_DURATION_MS,
      help: 'HTTP request duration in milliseconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [10, 50, 100, 200, 500, 1000, 2000, 5000],
      registers: [this.registry],
    });

    this.httpRequestsTotal = new Counter({
      name: HTTP_REQUESTS_TOTAL,
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status_code'],
      registers: [this.registry],
    });

    this.httpActiveRequests = new Gauge({
      name: HTTP_ACTIVE_REQUESTS,
      help: 'Number of currently active HTTP requests',
      registers: [this.registry],
    });

    this.invoicesTotal = new Counter({
      name: BUSINESS_INVOICES_TOTAL,
      help: 'Total invoices created',
      labelNames: ['tenant_id', 'status'],
      registers: [this.registry],
    });

    this.shiftsTotal = new Counter({
      name: BUSINESS_SHIFTS_TOTAL,
      help: 'Total shifts opened',
      labelNames: ['tenant_id', 'action'],
      registers: [this.registry],
    });

    this.expensesTotal = new Counter({
      name: BUSINESS_EXPENSES_TOTAL,
      help: 'Total expense requests',
      labelNames: ['tenant_id', 'status'],
      registers: [this.registry],
    });

    this.activeTenantsGauge = new Gauge({
      name: BUSINESS_ACTIVE_TENANTS,
      help: 'Number of active tenants',
      registers: [this.registry],
    });

    this.fiscalCoverageDaysMin = new Gauge({
      name: FISCAL_COVERAGE_DAYS_MIN,
      help: 'Smallest number of days of fiscal-year coverage left among tenants below the alert threshold',
      registers: [this.registry],
    });

    this.fiscalTenantsBelowThreshold = new Gauge({
      name: FISCAL_COVERAGE_TENANTS_BELOW_THRESHOLD,
      help: 'Number of tenants whose fiscal-year coverage is below the alert threshold',
      registers: [this.registry],
    });

    this.pooledSalesGuardViolation = new Gauge({
      name: POOLED_SALES_GUARD_VIOLATION,
      help: 'R-UNPOOLED: 1 when the production environment is in a state where sales lack accounting/COGS, by reason',
      labelNames: ['reason'],
      registers: [this.registry],
    });

    this.unpooledSaleAttempts = new Counter({
      name: UNPOOLED_SALE_ATTEMPTS_TOTAL,
      help: 'Sales attempted on the non-pooled (no accounting entry) path in production',
      labelNames: ['outcome'],
      registers: [this.registry],
    });

    // WP-E: durable financial exceptions recorded in the sale path. Label = the exception kind only (no tenant, no ids).
    this.financialExceptionsRecorded = new Counter({
      name: FINANCIAL_EXCEPTIONS_RECORDED_TOTAL,
      help: 'Financial exceptions durably recorded (swallowed stock/COGS/restock failures), by kind',
      labelNames: ['kind'],
      registers: [this.registry],
    });
  }

  recordFinancialException(
    kind: 'stock_deduction_failed' | 'cogs_missing' | 'restock_failed',
    count = 1,
  ): void {
    this.financialExceptionsRecorded.inc({ kind }, count);
  }

  setPooledSalesGuard(active: readonly string[]): void {
    for (const reason of [
      'database_url_missing',
      'pooled_writes_off',
      'stock_in_tx_off',
    ]) {
      this.pooledSalesGuardViolation.set(
        { reason },
        active.includes(reason) ? 1 : 0,
      );
    }
  }

  recordUnpooledSaleAttempt(outcome: 'refused' | 'flagged'): void {
    this.unpooledSaleAttempts.inc({ outcome });
  }

  setFiscalCoverage(daysMin: number, tenantsBelow: number): void {
    this.fiscalCoverageDaysMin.set(daysMin);
    this.fiscalTenantsBelowThreshold.set(tenantsBelow);
  }

  onModuleInit(): void {
    collectDefaultMetrics({
      register: this.registry,
      prefix: 'sefay_node_',
    });
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  getContentType(): string {
    return this.registry.contentType;
  }

  recordInvoice(tenantId: string, status: 'completed' | 'cancelled'): void {
    this.invoicesTotal.inc({ tenant_id: tenantId, status });
  }

  recordShift(tenantId: string, action: 'open' | 'close'): void {
    this.shiftsTotal.inc({ tenant_id: tenantId, action });
  }

  recordExpense(
    tenantId: string,
    status: 'requested' | 'approved' | 'rejected' | 'cancelled',
  ): void {
    this.expensesTotal.inc({ tenant_id: tenantId, status });
  }

  setActiveTenants(count: number): void {
    this.activeTenantsGauge.set(count);
  }
}
