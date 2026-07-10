import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../core/auth/jwt-auth.guard';
import { PermissionGuard } from '../../../core/permissions/permission.guard';
import { RequirePermission } from '../../../core/permissions/require-permission.decorator';
import { SuperAdminGuard } from '../guards/superadmin.guard';
import { AnalyticsService } from '../../shared/analytics/analytics.service';
import {
  AnalyticsQueryDto,
  AnalyticsPeriod,
} from '../../shared/analytics/dto/analytics-query.dto';

// SuperAdminGuard is load-bearing here, not decorative — see STATUS.md §83.
// `analytics.view.all` has resource:'analytics', not resource:'superadmin', so
// AccessControlService.assertPermissionIsCustomizable() does NOT block a
// tenant owner from granting it to their own role via the legitimate
// role-customization feature. Without this guard, that self-granted override
// was sufficient — PermissionGuard alone merges tenant overrides and has no
// concept of "platform-only" permissions — to read every tenant's MRR/ARR/
// churn/cohort data through this controller.
@Controller('superadmin/analytics')
@UseGuards(JwtAuthGuard, PermissionGuard, SuperAdminGuard)
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