import { Controller, Get, Post, Param, Body, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { AdjustmentsService } from './adjustments.service';
import { CreateAdjustmentDto } from './dto/create-adjustment.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { JwtPayload } from '../../shared/types/jwt-payload.type';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('inventory/adjustments')
export class AdjustmentsController {
  constructor(private readonly adjustmentsService: AdjustmentsService) {}

  @Get()
  @RequirePermission('inventory.view')
  findAll(
    @Query('status') status: string,
    @GetTenant() tenant: TenantContext,
    @Query('page') page?: string,
    @Query('per_page') perPage?: string,
  ) {
    return this.adjustmentsService.findAll(tenant.tenantId, status, page, perPage);
  }

  @Get(':id')
  @RequirePermission('inventory.view')
  findOne(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.adjustmentsService.findById(id, tenant.tenantId);
  }

  @Post()
  @RequirePermission('inventory.adjust')
  create(
    @Body() dto: CreateAdjustmentDto,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.adjustmentsService.create(tenant.tenantId, dto, user.sub);
  }

  @Post(':id/approve')
  @RequirePermission('inventory.adjust.approve')
  @HttpCode(HttpStatus.OK)
  approve(
    @Param('id') id: string,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.adjustmentsService.approve(id, tenant.tenantId, user.sub);
  }

  @Post(':id/reject')
  @RequirePermission('inventory.adjust.approve')
  @HttpCode(HttpStatus.OK)
  reject(
    @Param('id') id: string,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.adjustmentsService.reject(id, tenant.tenantId, user.sub);
  }

  @Post(':id/post')
  @RequirePermission('inventory.adjust')
  @HttpCode(HttpStatus.OK)
  post(
    @Param('id') id: string,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.adjustmentsService.post(id, tenant.tenantId, user.sub);
  }
}
