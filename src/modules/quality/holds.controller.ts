import { Controller, Get, Post, Body, Param, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { HoldsService } from './holds.service';
import { CreateHoldDto } from './dto/create-hold.dto';
import { ReleaseHoldDto } from './dto/release-hold.dto';
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
@Controller('quality/holds')
export class HoldsController {
  constructor(private readonly holdsService: HoldsService) {}

  @Get()
  @RequirePermission('quality.view')
  findAll(@GetTenant() tenant: TenantContext) {
    return this.holdsService.findAll(tenant.tenantId);
  }

  @Get(':id')
  @RequirePermission('quality.view')
  findOne(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.holdsService.findById(id, tenant.tenantId);
  }

  @Post()
  @RequirePermission('quality.manage')
  @Audit('quality_hold.created')
  create(@Body() dto: CreateHoldDto, @GetTenant() tenant: TenantContext, @CurrentUser() user: JwtPayload) {
    return this.holdsService.create(tenant.tenantId, dto, user.sub);
  }

  @Post(':id/release')
  @RequirePermission('quality.manage')
  @HttpCode(HttpStatus.OK)
  release(
    @Param('id') id: string,
    @Body() dto: ReleaseHoldDto,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.holdsService.release(id, tenant.tenantId, user.sub, dto);
  }
}
