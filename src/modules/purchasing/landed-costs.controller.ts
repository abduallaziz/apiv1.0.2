import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
import { LandedCostsService } from './landed-costs.service';
import { CreateLandedCostDto } from './dto/create-landed-cost.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { JwtPayload } from '../../shared/types/jwt-payload.type';
import { Audit } from '../../core/audit/audit.decorator';

// Migration 13.15-fix (#15, Costing) — exposes the existing landed_costs
// table (migration 110). fn_post_goods_receipt itself is not modified;
// the existing allocation logic there remains the sole source of truth
// for how these rows get baked into unit_cost.
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('purchasing/goods-receipts/:id/landed-costs')
export class LandedCostsController {
  constructor(private readonly landedCostsService: LandedCostsService) {}

  @Get()
  @RequirePermission('purchasing.view')
  findAll(@Param('id') goodsReceiptId: string, @GetTenant() tenant: TenantContext) {
    return this.landedCostsService.findByReceipt(goodsReceiptId, tenant.tenantId);
  }

  @Post()
  @RequirePermission('purchasing.manage')
  @Audit('landed_cost.created')
  create(
    @Param('id') goodsReceiptId: string,
    @Body() dto: CreateLandedCostDto,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.landedCostsService.create(goodsReceiptId, tenant.tenantId, user.sub, dto);
  }
}
