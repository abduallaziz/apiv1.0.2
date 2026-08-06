import { Injectable } from '@nestjs/common';
import { AdvancedAnalyticsRepository } from './repositories/advanced-analytics.repository';

@Injectable()
export class AdvancedAnalyticsService {
  constructor(private readonly advancedAnalyticsRepo: AdvancedAnalyticsRepository) {}

  valuation(tenantId: string, warehouseId?: string) {
    return this.advancedAnalyticsRepo.valuationReport(tenantId, warehouseId);
  }

  turnover(tenantId: string, dateFrom: string, dateTo: string, warehouseId?: string) {
    return this.advancedAnalyticsRepo.turnoverReport(tenantId, dateFrom, dateTo, warehouseId);
  }

  aging(tenantId: string, warehouseId?: string) {
    return this.advancedAnalyticsRepo.agingReport(tenantId, warehouseId);
  }

  abcAnalysis(tenantId: string, dateFrom: string, dateTo: string, warehouseId?: string) {
    return this.advancedAnalyticsRepo.abcAnalysis(tenantId, dateFrom, dateTo, warehouseId);
  }

  deadStock(tenantId: string, lookbackDays?: number, warehouseId?: string) {
    return this.advancedAnalyticsRepo.deadStockReport(tenantId, lookbackDays, warehouseId);
  }

  slowMoving(tenantId: string, lookbackDays?: number, maxUnitsSold?: number, warehouseId?: string) {
    return this.advancedAnalyticsRepo.slowMovingReport(tenantId, lookbackDays, maxUnitsSold, warehouseId);
  }

  overstock(tenantId: string, warehouseId?: string) {
    return this.advancedAnalyticsRepo.overstockReport(tenantId, warehouseId);
  }

  stockAccuracy(tenantId: string, dateFrom: string, dateTo: string, warehouseId?: string) {
    return this.advancedAnalyticsRepo.stockAccuracyReport(tenantId, dateFrom, dateTo, warehouseId);
  }

  coverage(tenantId: string, warehouseId?: string) {
    return this.advancedAnalyticsRepo.coverageReport(tenantId, warehouseId);
  }
}
