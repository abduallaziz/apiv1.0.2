import { Controller, Get, Patch, Param, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { LeavesService } from './leaves.service';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant-context';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('leaves')
export class LeavesController {
  constructor(private readonly service: LeavesService) {}

  @Get()
  @RequirePermission('hr.manage')
  findAll(@GetTenant() tenant: TenantContext, @Query('status') status?: 'pending' | 'approved' | 'rejected') {
    return this.service.findAll(tenant, status);
  }

  @Patch(':id/approve')
  @RequirePermission('hr.manage')
  approve(@Param('id', ParseUUIDPipe) id: string, @GetTenant() tenant: TenantContext) {
    return this.service.updateStatus(id, tenant, 'approved');
  }

  @Patch(':id/reject')
  @RequirePermission('hr.manage')
  reject(@Param('id', ParseUUIDPipe) id: string, @GetTenant() tenant: TenantContext) {
    return this.service.updateStatus(id, tenant, 'rejected');
  }
}
