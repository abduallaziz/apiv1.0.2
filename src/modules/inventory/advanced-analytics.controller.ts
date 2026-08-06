import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdvancedAnalyticsService } from './advanced-analytics.service';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('inventory/analytics')
export class AdvancedAnalyticsController {
  constructor(private readonly advancedAnalyticsService: AdvancedAnalyticsService) {}

  @Get('valuation')
  @RequirePermission('inventory.view')
  valuation(@GetTenant() tenant: TenantContext, @Query('warehouse_id') warehouseId?: string) {
    return this.advancedAnalyticsService.valuation(tenant.tenantId, warehouseId);
  }

  @Get('turnover')
  @RequirePermission('inventory.view')
  turnover(
    @GetTenant() tenant: TenantContext,
    @Query('date_from') dateFrom: string,
    @Query('date_to') dateTo: string,
    @Query('warehouse_id') warehouseId?: string,
  ) {
    return this.advancedAnalyticsService.turnover(tenant.tenantId, dateFrom, dateTo, warehouseId);
  }

  @Get('aging')
  @RequirePermission('inventory.view')
  aging(@GetTenant() tenant: TenantContext, @Query('warehouse_id') warehouseId?: string) {
    return this.advancedAnalyticsService.aging(tenant.tenantId, warehouseId);
  }

  @Get('abc-analysis')
  @RequirePermission('inventory.view')
  abcAnalysis(
    @GetTenant() tenant: TenantContext,
    @Query('date_from') dateFrom: string,
    @Query('date_to') dateTo: string,
    @Query('warehouse_id') warehouseId?: string,
  ) {
    return this.advancedAnalyticsService.abcAnalysis(tenant.tenantId, dateFrom, dateTo, warehouseId);
  }

  @Get('dead-stock')
  @RequirePermission('inventory.view')
  deadStock(
    @GetTenant() tenant: TenantContext,
    @Query('lookback_days') lookbackDays?: string,
    @Query('warehouse_id') warehouseId?: string,
  ) {
    return this.advancedAnalyticsService.deadStock(
      tenant.tenantId,
      lookbackDays ? Number(lookbackDays) : undefined,
      warehouseId,
    );
  }

  @Get('slow-moving')
  @RequirePermission('inventory.view')
  slowMoving(
    @GetTenant() tenant: TenantContext,
    @Query('lookback_days') lookbackDays?: string,
    @Query('max_units_sold') maxUnitsSold?: string,
    @Query('warehouse_id') warehouseId?: string,
  ) {
    return this.advancedAnalyticsService.slowMoving(
      tenant.tenantId,
      lookbackDays ? Number(lookbackDays) : undefined,
      maxUnitsSold ? Number(maxUnitsSold) : undefined,
      warehouseId,
    );
  }

  @Get('overstock')
  @RequirePermission('inventory.view')
  overstock(@GetTenant() tenant: TenantContext, @Query('warehouse_id') warehouseId?: string) {
    return this.advancedAnalyticsService.overstock(tenant.tenantId, warehouseId);
  }

  @Get('stock-accuracy')
  @RequirePermission('inventory.view')
  stockAccuracy(
    @GetTenant() tenant: TenantContext,
    @Query('date_from') dateFrom: string,
    @Query('date_to') dateTo: string,
    @Query('warehouse_id') warehouseId?: string,
  ) {
    return this.advancedAnalyticsService.stockAccuracy(tenant.tenantId, dateFrom, dateTo, warehouseId);
  }

  @Get('coverage')
  @RequirePermission('inventory.view')
  coverage(@GetTenant() tenant: TenantContext, @Query('warehouse_id') warehouseId?: string) {
    return this.advancedAnalyticsService.coverage(tenant.tenantId, warehouseId);
  }
}
