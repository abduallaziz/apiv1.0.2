import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('inventory/reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('overview')
  @RequirePermission('inventory.view')
  overview(@GetTenant() tenant: TenantContext) {
    return this.reportsService.overview(tenant.tenantId);
  }

  @Get('expiring-batches')
  @RequirePermission('inventory.view')
  expiringBatches(
    @GetTenant() tenant: TenantContext,
    @Query('days_ahead') daysAhead?: string,
  ) {
    return this.reportsService.expiringBatches(
      tenant.tenantId,
      daysAhead ? parseInt(daysAhead, 10) : undefined,
    );
  }
}
