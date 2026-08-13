import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PlanningService } from './planning.service';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('inventory/planning')
export class PlanningController {
  constructor(private readonly planningService: PlanningService) {}

  @Get('demand-forecast')
  @RequirePermission('inventory.view')
  demandForecast(
    @GetTenant() tenant: TenantContext,
    @Query('warehouse_id') warehouseId: string,
    @Query('item_id') itemId: string,
    @Query('variant_id') variantId?: string,
    @Query('lookback_days') lookbackDays?: string,
  ) {
    return this.planningService.calculateDemandForecast(
      tenant.tenantId,
      warehouseId,
      itemId,
      variantId,
      lookbackDays ? Number(lookbackDays) : undefined,
    );
  }

  @Get('purchase-suggestions')
  @RequirePermission('inventory.view')
  purchaseSuggestions(@GetTenant() tenant: TenantContext) {
    return this.planningService.purchaseSuggestions(tenant.tenantId);
  }

  @Get('safety-stock')
  @RequirePermission('inventory.view')
  safetyStock(
    @GetTenant() tenant: TenantContext,
    @Query('warehouse_id') warehouseId: string,
    @Query('item_id') itemId: string,
    @Query('variant_id') variantId?: string,
    @Query('lookback_days') lookbackDays?: string,
  ) {
    return this.planningService.calculateSafetyStock(
      tenant.tenantId,
      warehouseId,
      itemId,
      variantId,
      lookbackDays ? Number(lookbackDays) : undefined,
    );
  }
}
