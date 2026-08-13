import { Controller, Get, Post, Param, Query, UseGuards } from '@nestjs/common';
import { MrpService } from './mrp.service';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { JwtPayload } from '../../shared/types/jwt-payload.type';

// Every route here requires 'manufacturing.plan' (first real use of this
// previously-unused permission key). /convert additionally requires a
// second, order-type-specific permission checked in MrpService — a single
// decorator cannot branch on request data.
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('inventory/planning/mrp')
export class MrpController {
  constructor(private readonly mrpService: MrpService) {}

  @Post('run')
  @RequirePermission('manufacturing.plan')
  run(
    @GetTenant() tenant: TenantContext,
    @Query('warehouse_id') warehouseId: string,
  ) {
    return this.mrpService.run(tenant.tenantId, warehouseId);
  }

  @Get('planned-orders')
  @RequirePermission('manufacturing.plan')
  findAll(
    @GetTenant() tenant: TenantContext,
    @Query('status') status?: string,
    @Query('order_type') orderType?: string,
  ) {
    return this.mrpService.findAll(tenant.tenantId, status, orderType);
  }

  @Get('planned-orders/:id')
  @RequirePermission('manufacturing.plan')
  findOne(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.mrpService.findById(id, tenant.tenantId);
  }

  @Post('planned-orders/:id/approve')
  @RequirePermission('manufacturing.plan')
  approve(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.mrpService.approve(id, tenant.tenantId);
  }

  @Post('planned-orders/:id/cancel')
  @RequirePermission('manufacturing.plan')
  cancel(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.mrpService.cancel(id, tenant.tenantId);
  }

  @Post('planned-orders/:id/convert')
  @RequirePermission('manufacturing.plan')
  convert(
    @Param('id') id: string,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.mrpService.convert(id, tenant.tenantId, user.role, user.sub);
  }
}
