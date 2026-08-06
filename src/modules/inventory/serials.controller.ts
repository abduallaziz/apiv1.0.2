import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { SerialsService } from './serials.service';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';

// All routes reuse the existing inventory.view permission — same read
// gate already used by Reports/WMS/Reservations in this module. No new
// permission was created (per approved scope).
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('inventory/serials')
export class SerialsController {
  constructor(private readonly serialsService: SerialsService) {}

  // Static-segment routes must be registered before ':id' — same
  // ordering requirement already established for item-barcodes'
  // lookup/:barcode vs :id.
  @Get('search/:serialNumber')
  @RequirePermission('inventory.view')
  findByNumber(
    @Param('serialNumber') serialNumber: string,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.serialsService.findByNumber(serialNumber, tenant.tenantId);
  }

  @Get('item/:itemId')
  @RequirePermission('inventory.view')
  findByItem(
    @Param('itemId') itemId: string,
    @GetTenant() tenant: TenantContext,
    @Query('status') status?: string,
  ) {
    return this.serialsService.findByItem(itemId, tenant.tenantId, status);
  }

  @Get('warehouse/:warehouseId')
  @RequirePermission('inventory.view')
  findByWarehouse(
    @Param('warehouseId') warehouseId: string,
    @GetTenant() tenant: TenantContext,
    @Query('status') status?: string,
  ) {
    return this.serialsService.findByWarehouse(warehouseId, tenant.tenantId, status);
  }

  @Get('customer/:customerId')
  @RequirePermission('inventory.view')
  findByCustomer(
    @Param('customerId') customerId: string,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.serialsService.findByCustomer(customerId, tenant.tenantId);
  }

  @Get(':id/warranty')
  @RequirePermission('inventory.view')
  warrantyStatus(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.serialsService.getWarrantyStatus(id, tenant.tenantId);
  }

  @Get(':id/history')
  @RequirePermission('inventory.view')
  lifecycleHistory(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.serialsService.getLifecycleHistory(id, tenant.tenantId);
  }

  @Get(':id/customer-history')
  @RequirePermission('inventory.view')
  customerHistory(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.serialsService.getCustomerHistory(id, tenant.tenantId);
  }

  @Get(':id')
  @RequirePermission('inventory.view')
  findOne(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.serialsService.findById(id, tenant.tenantId);
  }
}
