import {
  Controller,
  Get,
  Patch,
  Body,
  UseGuards,
} from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { UpdateTenantProfileDto } from './dto/update-tenant-profile.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant-context';

@Controller('tenant')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Get('profile')
  @RequirePermission('settings.view')
  getProfile(@GetTenant() tenant: TenantContext) {
    return this.tenantsService.getProfile(tenant.tenantId);
  }

  @Patch('profile')
  @RequirePermission('settings.manage')
  updateProfile(
    @GetTenant() tenant: TenantContext,
    @Body() dto: UpdateTenantProfileDto,
  ) {
    return this.tenantsService.updateProfile(tenant.tenantId, dto);
  }

  @Get('subscription')
  @RequirePermission('settings.view')
  getSubscription(@GetTenant() tenant: TenantContext) {
    return this.tenantsService.getSubscription(tenant.tenantId);
  }

  @Get('usage')
  @RequirePermission('settings.view')
  getUsage(@GetTenant() tenant: TenantContext) {
    return this.tenantsService.getUsage(tenant.tenantId);
  }

  @Get('pos-config')
  @RequirePermission('invoice.create.own')
  getPosConfig(@GetTenant() tenant: TenantContext) {
    return this.tenantsService.getPosConfig(tenant.tenantId);
  }
}