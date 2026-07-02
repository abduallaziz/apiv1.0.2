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