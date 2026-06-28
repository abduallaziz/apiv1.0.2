import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { StockService } from './stock.service';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('inventory/stock')
export class StockController {
  constructor(private readonly stockService: StockService) {}

  @Get('levels')
  @RequirePermission('inventory.view')
  findLevels(
    @GetTenant() tenant: TenantContext,
    @Query('warehouse_id') warehouseId?: string,
    @Query('item_id') itemId?: string,
    @Query('variant_id') variantId?: string,
  ) {
    return this.stockService.findLevels(tenant.tenantId, { warehouseId, itemId, variantId });
  }

  @Get('movements')
  @RequirePermission('inventory.view')
  findMovements(
    @GetTenant() tenant: TenantContext,
    @Query('warehouse_id') warehouseId?: string,
    @Query('item_id') itemId?: string,
    @Query('variant_id') variantId?: string,
    @Query('reference_type') referenceType?: string,
    @Query('reference_id') referenceId?: string,
    @Query('page') page = '1',
    @Query('per_page') perPage = '50',
  ) {
    return this.stockService.findMovements(
      tenant.tenantId,
      { warehouseId, itemId, variantId, referenceType, referenceId },
      Number(page),
      Number(perPage),
    );
  }
}
