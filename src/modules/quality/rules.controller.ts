import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { QualityConfigService } from './quality-config.service';
import { CreateRuleDto } from './dto/create-rule.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';
import { Audit } from '../../core/audit/audit.decorator';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('quality/rules')
export class RulesController {
  constructor(private readonly configService: QualityConfigService) {}

  @Get()
  @RequirePermission('quality.view')
  findAll(@GetTenant() tenant: TenantContext) {
    return this.configService.findAllRules(tenant.tenantId);
  }

  @Post()
  @RequirePermission('quality.manage')
  @Audit('quality_rule.created')
  create(@Body() dto: CreateRuleDto, @GetTenant() tenant: TenantContext) {
    return this.configService.createRule(tenant.tenantId, dto);
  }
}
