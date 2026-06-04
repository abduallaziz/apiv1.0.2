import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../core/auth/jwt-auth.guard';
import { PermissionGuard } from '../../../core/permissions/permission.guard';
import { RequirePermission } from '../../../core/permissions/require-permission.decorator';
import { AnalyticsService } from '../../shared/analytics/analytics.service';
import {
  AnalyticsQueryDto,
  AnalyticsPeriod,
} from '../../shared/analytics/dto/analytics-query.dto';

@Controller('superadmin/analytics')
@UseGuards(JwtAuthGuard, PermissionGuard)
@RequirePermission('analytics.view.all')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('summary')
  getSummary(@Query() query: AnalyticsQueryDto) {
    const period = query.period ?? AnalyticsPeriod.LAST_12_MONTHS;
    return this.analyticsService.getAdvancedSummary(period, query.from, query.to);
  }

  @Get('mrr')
  getMRR() {
    return this.analyticsService.getMRR();
  }

  @Get('arr')
  getARR() {
    return this.analyticsService.getARR();
  }

  @Get('mrr/history')
  getMRRHistory(@Query() query: AnalyticsQueryDto) {
    const period = query.period ?? AnalyticsPeriod.LAST_12_MONTHS;
    return this.analyticsService.getMRRHistory(period, query.from, query.to);
  }

  @Get('churn')
  getChurnRate(@Query() query: AnalyticsQueryDto) {
    const period = query.period ?? AnalyticsPeriod.LAST_12_MONTHS;
    return this.analyticsService.getChurnRate(period, query.from, query.to);
  }

  @Get('growth')
  getGrowthRate(@Query() query: AnalyticsQueryDto) {
    const period = query.period ?? AnalyticsPeriod.LAST_12_MONTHS;
    return this.analyticsService.getGrowthRate(period, query.from, query.to);
  }

  @Get('funnel')
  getConversionFunnel(@Query() query: AnalyticsQueryDto) {
    const period = query.period ?? AnalyticsPeriod.LAST_12_MONTHS;
    return this.analyticsService.getConversionFunnel(period, query.from, query.to);
  }

  @Get('cohort')
  getCohortAnalysis() {
    return this.analyticsService.getCohortAnalysis();
  }

  @Get('revenue-by-plan')
  getRevenueByPlan() {
    return this.analyticsService.getRevenueByPlan();
  }

  @Get('usage')
  getUsageAnalytics(@Query() query: AnalyticsQueryDto) {
    const period = query.period ?? AnalyticsPeriod.LAST_30_DAYS;
    return this.analyticsService.getUsageAnalytics(period, query.from, query.to);
  }
}