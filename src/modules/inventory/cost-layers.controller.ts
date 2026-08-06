import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { StockService } from './stock.service';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';

// Migration 13.15-fix (#15, Costing) — read-only visibility into an
// existing, unmodified table (cost_layers). Reuses StockService/
// StockRepository rather than a new service, and inventory.view (same
// permission as every other read endpoint in this module) rather than a
// new one.
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('inventory/cost-layers')
export class CostLayersController {
  constructor(private readonly stockService: StockService) {}

  @Get()
  @RequirePermission('inventory.view')
  findAll(
    @GetTenant() tenant: TenantContext,
    @Query('item_id') itemId?: string,
    @Query('warehouse_id') warehouseId?: string,
  ) {
    return this.stockService.findCostLayers(tenant.tenantId, { itemId, warehouseId });
  }
}
