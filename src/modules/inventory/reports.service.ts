import { Injectable } from '@nestjs/common';
import { ReportsRepository } from './repositories/reports.repository';

@Injectable()
export class ReportsService {
  constructor(private readonly reportsRepo: ReportsRepository) {}

  async overview(tenantId: string) {
    const [
      purchaseOrders,
      goodsReceipts,
      adjustments,
      transfers,
      stockCountsVariance,
      warehouseValuation,
      lowStock,
      expiringBatches,
    ] = await Promise.all([
      this.reportsRepo.purchaseOrdersSummary(tenantId),
      this.reportsRepo.goodsReceiptsSummary(tenantId),
      this.reportsRepo.adjustmentsSummary(tenantId),
      this.reportsRepo.transfersSummary(tenantId),
      this.reportsRepo.stockCountsVarianceSummary(tenantId),
      this.reportsRepo.warehouseValuation(tenantId),
      this.reportsRepo.lowStockBelowReorder(tenantId),
      this.reportsRepo.batchesExpiringSoon(tenantId),
    ]);

    return {
      purchaseOrders,
      goodsReceipts,
      adjustments,
      transfers,
      stockCountsVariance,
      warehouseValuation,
      lowStock,
      expiringBatches,
    };
  }

  expiringBatches(tenantId: string, daysAhead?: number) {
    return this.reportsRepo.batchesExpiringSoon(tenantId, daysAhead);
  }
}
