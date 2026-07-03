import { Controller, Get, Patch, Param, Body, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { KitchenService } from './kitchen.service';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant-context';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('kitchen')
export class KitchenController {
  constructor(private readonly service: KitchenService) {}

  @Get('orders')
  @RequirePermission('kitchen.manage')
  getActiveOrders(@GetTenant() tenant: TenantContext, @Query('branch_id') branchId?: string) {
    return this.service.getActiveOrders(tenant, branchId);
  }

  @Patch('items/:id')
  @RequirePermission('kitchen.manage')
  updateItemStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @GetTenant() tenant: TenantContext,
    @Body('status') status: string,
  ) {
    return this.service.updateItemStatus(tenant, id, status);
  }
}
