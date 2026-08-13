import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { PutawayService } from './putaway.service';
import { CreatePutawayRuleDto } from './dto/create-putaway-rule.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';
import { Audit } from '../../core/audit/audit.decorator';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('inventory/putaway')
export class PutawayController {
  constructor(private readonly putawayService: PutawayService) {}

  @Get('rules')
  @RequirePermission('inventory.view')
  findAllRules(@GetTenant() tenant: TenantContext) {
    return this.putawayService.findAllRules(tenant.tenantId);
  }

  @Post('rules')
  @RequirePermission('warehouse.manage')
  @Audit('putaway_rule.created')
  createRule(
    @Body() dto: CreatePutawayRuleDto,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.putawayService.createRule(tenant.tenantId, dto);
  }

  @Get('suggest')
  @RequirePermission('inventory.view')
  suggest(
    @GetTenant() tenant: TenantContext,
    @Query('warehouse_id') warehouseId: string,
    @Query('item_id') itemId: string,
    @Query('quantity') quantity: string,
  ) {
    return this.putawayService.suggest(
      tenant.tenantId,
      warehouseId,
      itemId,
      Number(quantity),
    );
  }
}
