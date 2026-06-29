import { Injectable } from '@nestjs/common';
import { AnalyticsRepository } from './repositories/analytics.repository';

@Injectable()
export class AnalyticsService {
  constructor(private readonly analyticsRepo: AnalyticsRepository) {}

  async dashboard(tenantId: string) {
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
