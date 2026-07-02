import { Injectable } from '@nestjs/common';
import { AnalyticsRepository } from './repositories/analytics.repository';
import { RedisCacheService } from '../../core/cache/redis-cache.service';

const DASHBOARD_TTL = 300; // 5 minutes

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly analyticsRepo: AnalyticsRepository,
    private readonly cache: RedisCacheService,
  ) {}

  async dashboard(tenantId: string) {
    const cacheKey = `dashboard:tenant:${tenantId}`;

    const cached = await this.cache.get<Awaited<ReturnType<typeof this.fetchDashboard>>>(cacheKey);
    if (cached) return cached;

    const data = await this.fetchDashboard(tenantId);
    await this.cache.set(cacheKey, data, DASHBOARD_TTL);
    return data;
  }

  private async fetchDashboard(tenantId: string) {
    const [summary, warehouses, recentMovements, lowStock, purchaseOrders] = await Promise.all([
      this.analyticsRepo.dashboardSummary(tenantId),
      this.analyticsRepo.warehouseSummary(tenantId),
      this.analyticsRepo.recentMovements(tenantId, 10),
      this.analyticsRepo.lowStockList(tenantId, 10),
      this.analyticsRepo.purchaseOrdersWaitingReceipt(tenantId, 10),
    ]);

    return {
      summary,
      warehouses,
      recentMovements,
      lowStock,
      purchaseOrdersWaitingReceipt: purchaseOrders,
    };
  }
}
