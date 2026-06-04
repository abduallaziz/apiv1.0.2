import { Injectable } from '@nestjs/common';
import { PlatformAnalyticsRepository } from './platform-analytics.repository';
import { AnalyticsPeriod } from './dto/analytics-query.dto';

export interface RevenuePoint {
  date: string;
  total: number;
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly repo: PlatformAnalyticsRepository) {}

  // ─── Existing ─────────────────────────────────────────────────────────────

  getGlobalStats() {
    return this.repo.getGlobalStats();
  }

  async getRevenueReport(params: {
    from: string;
    to: string;
    tenantId?: string;
    groupBy?: 'day' | 'month';
  }): Promise<RevenuePoint[]> {
    const rows = await this.repo.getRevenueReport(params);
    const grouped: Record<string, number> = {};

    for (const row of rows) {
      const date = new Date((row as any).created_at);
      const key =
        params.groupBy === 'month'
          ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
          : date.toISOString().split('T')[0];
      grouped[key] = (grouped[key] ?? 0) + Number((row as any).total ?? 0);
    }

    return Object.entries(grouped)
      .map(([date, total]) => ({ date, total }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  async getTenantStats(tenantId: string, tenantRepo: any) {
    return tenantRepo.getStats(tenantId);
  }

  // ─── Advanced ─────────────────────────────────────────────────────────────

  async getMRR() {
    return { mrr: await this.repo.getMRR() };
  }

  async getARR() {
    return { arr: await this.repo.getARR() };
  }

  async getMRRHistory(period: AnalyticsPeriod, from?: string, to?: string) {
    return this.repo.getMRRHistory(period, from, to);
  }

  async getChurnRate(period: AnalyticsPeriod, from?: string, to?: string) {
    return this.repo.getChurnRate(period, from, to);
  }

  async getGrowthRate(period: AnalyticsPeriod, from?: string, to?: string) {
    return this.repo.getGrowthRate(period, from, to);
  }

  async getConversionFunnel(period: AnalyticsPeriod, from?: string, to?: string) {
    return this.repo.getConversionFunnel(period, from, to);
  }

  async getCohortAnalysis() {
    return this.repo.getCohortAnalysis();
  }

  async getRevenueByPlan() {
    return this.repo.getRevenueByPlan();
  }

  async getUsageAnalytics(period: AnalyticsPeriod, from?: string, to?: string) {
    return this.repo.getUsageAnalytics(period, from, to);
  }

  async getAdvancedSummary(period: AnalyticsPeriod, from?: string, to?: string) {
    const [mrr, arr, churn, growth, funnel, revenueByPlan] = await Promise.all([
      this.repo.getMRR(),
      this.repo.getARR(),
      this.repo.getChurnRate(period, from, to),
      this.repo.getGrowthRate(period, from, to),
      this.repo.getConversionFunnel(period, from, to),
      this.repo.getRevenueByPlan(),
    ]);

    return {
      mrr,
      arr,
      churnRate: churn.churnRate,
      growthRate: growth.growthRate,
      newTenants: growth.newTenants,
      conversion: {
        trialConversionRate: funnel.trialConversionRate,
        overallConversionRate: funnel.overallConversionRate,
        avgDaysToConvert: funnel.avgDaysToConvert,
      },
      revenueByPlan,
    };
  }
}