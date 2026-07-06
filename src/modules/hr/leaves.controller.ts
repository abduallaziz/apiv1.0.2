import { Controller, Get, Patch, Param, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { LeavesService } from './leaves.service';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant-context';
import { Audit } from '../../core/audit/audit.decorator';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('leaves')
export class LeavesController {
  constructor(private readonly service: LeavesService) {}

  @Get()
  @RequirePermission('hr.manage')
  findAll(
    @GetTenant() tenant: TenantContext,
    @Query('status') status?: 'pending' | 'approved' | 'rejected',
    @Query('user_id') userId?: string,
  ) {
    return this.service.findAll(tenant, status, userId);
  }

  @Patch(':id/approve')
  @Audit('leave.request.approved')
  @RequirePermission('hr.manage')
  approve(@Param('id', ParseUUIDPipe) id: string, @GetTenant() tenant: TenantContext) {
    return this.service.updateStatus(id, tenant, 'approved');
  }

  @Patch(':id/reject')
  @Audit('leave.request.rejected')
  @RequirePermission('hr.manage')
  reject(@Param('id', ParseUUIDPipe) id: string, @GetTenant() tenant: TenantContext) {
    return this.service.updateStatus(id, tenant, 'rejected');
  }
}
