import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { QualityConfigService } from './quality-config.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';
import { Audit } from '../../core/audit/audit.decorator';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('quality/plans')
export class PlansController {
  constructor(private readonly configService: QualityConfigService) {}

  @Get()
  @RequirePermission('quality.view')
  findAll(@GetTenant() tenant: TenantContext) {
    return this.configService.findAllPlans(tenant.tenantId);
  }

  @Post()
  @RequirePermission('quality.manage')
  @Audit('quality_plan.created')
  create(@Body() dto: CreatePlanDto, @GetTenant() tenant: TenantContext) {
    return this.configService.createPlan(tenant.tenantId, dto);
  }
}
