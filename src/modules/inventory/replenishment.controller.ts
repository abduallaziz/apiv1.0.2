import { Controller, Get, Post, Body, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ReplenishmentService } from './replenishment.service';
import { CreateReplenishmentRuleDto } from './dto/create-replenishment-rule.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { JwtPayload } from '../../shared/types/jwt-payload.type';
import { Audit } from '../../core/audit/audit.decorator';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('inventory/replenishment')
export class ReplenishmentController {
  constructor(private readonly replenishmentService: ReplenishmentService) {}

  @Get('rules')
  @RequirePermission('inventory.view')
  findAllRules(@GetTenant() tenant: TenantContext) {
    return this.replenishmentService.findAllRules(tenant.tenantId);
  }

  @Post('rules')
  @RequirePermission('warehouse.manage')
  @Audit('replenishment_rule.created')
  createRule(@Body() dto: CreateReplenishmentRuleDto, @GetTenant() tenant: TenantContext) {
    return this.replenishmentService.createRule(tenant.tenantId, dto);
  }

  @Post('run-check')
  @RequirePermission('warehouse.manage')
  @HttpCode(HttpStatus.OK)
  runCheck(
    @GetTenant() tenant: TenantContext,
    @Query('warehouse_id') warehouseId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.replenishmentService.runCheck(tenant.tenantId, warehouseId, user.sub);
  }
}
