import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
import { ScrapService } from './scrap.service';
import { CreateScrapDto } from './dto/create-scrap.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { JwtPayload } from '../../shared/types/jwt-payload.type';
import { Audit } from '../../core/audit/audit.decorator';

// Migration 13.16A (#16, Manufacturing — Scrap Tracking). Recording scrap
// is an execution-time action (same category as start/complete/cancel),
// so it reuses manufacturing.execute rather than manufacturing.manage —
// still one of the three permissions the approved scope named, no new one.
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('manufacturing/production-orders/:id/scrap')
export class ScrapController {
  constructor(private readonly scrapService: ScrapService) {}

  @Get()
  @RequirePermission('manufacturing.view')
  findAll(
    @Param('id') productionOrderId: string,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.scrapService.findByProductionOrder(
      productionOrderId,
      tenant.tenantId,
    );
  }

  @Post()
  @RequirePermission('manufacturing.execute')
  @Audit('production_order.scrap_recorded')
  record(
    @Param('id') productionOrderId: string,
    @Body() dto: CreateScrapDto,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.scrapService.record(
      productionOrderId,
      tenant.tenantId,
      user.sub,
      dto,
    );
  }
}
