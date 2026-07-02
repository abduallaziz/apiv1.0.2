import { Controller, Get, UseGuards } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('inventory/analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('dashboard')
  @RequirePermission('inventory.view')
  dashboard(@GetTenant() tenant: TenantContext) {
    return this.analyticsService.dashboard(tenant.tenantId);
  }
}
