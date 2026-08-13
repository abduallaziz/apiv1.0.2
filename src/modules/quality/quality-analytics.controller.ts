import { Controller, Get, UseGuards } from '@nestjs/common';
import { QualityAnalyticsRepository } from './repositories/quality-analytics.repository';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('quality/analytics')
export class QualityAnalyticsController {
  constructor(private readonly analyticsRepo: QualityAnalyticsRepository) {}

  @Get('inspections')
  @RequirePermission('quality.view')
  inspections(@GetTenant() tenant: TenantContext) {
    return this.analyticsRepo.inspectionSummary(tenant.tenantId);
  }

  @Get('ncr-trends')
  @RequirePermission('quality.view')
  ncrTrends(@GetTenant() tenant: TenantContext) {
    return this.analyticsRepo.ncrTrends(tenant.tenantId);
  }

  @Get('capa-performance')
  @RequirePermission('quality.view')
  capaPerformance(@GetTenant() tenant: TenantContext) {
    return this.analyticsRepo.capaPerformance(tenant.tenantId);
  }

  @Get('supplier-ranking')
  @RequirePermission('quality.view')
  supplierRanking(@GetTenant() tenant: TenantContext) {
    return this.analyticsRepo.supplierQualityRanking(tenant.tenantId);
  }

  @Get('quality-cost')
  @RequirePermission('quality.view')
  qualityCost(@GetTenant() tenant: TenantContext) {
    return this.analyticsRepo.qualityCostSummary(tenant.tenantId);
  }
}
