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

  // Available-To-Promise — spec item 3a (GET /items/:id/atp), exposed here
  // under inventory/stock for consistency with every other stock read
  // endpoint on this controller, with warehouse_id/variant_id as explicit
  // query params since ATP is meaningless without a specific warehouse.
  @Get('atp')
  @RequirePermission('inventory.view')
  findAtp(
    @GetTenant() tenant: TenantContext,
    @Query('warehouse_id') warehouseId: string,
    @Query('item_id') itemId: string,
    @Query('variant_id') variantId?: string,
  ) {
    return this.stockService.findAtp(tenant.tenantId, warehouseId, itemId, variantId);
  }

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

  @Get('levels/enriched')
  @RequirePermission('inventory.view')
  findLevelsEnriched(
    @GetTenant() tenant: TenantContext,
    @Query('warehouse_id') warehouseId?: string,
    @Query('item_id') itemId?: string,
    @Query('category_id') categoryId?: string,
    @Query('location_id') locationId?: string,
    @Query('batch_id') batchId?: string,
    @Query('supplier_id') supplierId?: string,
    @Query('status') status?: string,
  ) {
    return this.stockService.findLevelsEnriched(tenant.tenantId, {
      warehouseId,
      itemId,
      categoryId,
      locationId,
      batchId,
      supplierId,
      status,
    });
  }

  @Get('movements/ledger')
  @RequirePermission('inventory.view')
  findMovementsLedger(
    @GetTenant() tenant: TenantContext,
    @Query('warehouse_id') warehouseId?: string,
    @Query('item_id') itemId?: string,
    @Query('movement_type') movementType?: string,
    @Query('reference_type') referenceType?: string,
    @Query('reference_id') referenceId?: string,
    @Query('created_by') createdBy?: string,
    @Query('date_from') dateFrom?: string,
    @Query('date_to') dateTo?: string,
    @Query('page') page = '1',
    @Query('per_page') perPage = '50',
  ) {
    return this.stockService.findMovementsLedger(
      tenant.tenantId,
      { warehouseId, itemId, movementType, referenceType, referenceId, createdBy, dateFrom, dateTo },
      Number(page),
      Number(perPage),
    );
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
