import { Controller, Get, Post, Param, Body, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { TransfersService } from './transfers.service';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { JwtPayload } from '../../shared/types/jwt-payload.type';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('inventory/transfers')
export class TransfersController {
  constructor(private readonly transfersService: TransfersService) {}

  @Get()
  @RequirePermission('inventory.view')
  findAll(@Query('status') status: string, @GetTenant() tenant: TenantContext) {
    return this.transfersService.findAll(tenant.tenantId, status);
  }

  @Get(':id')
  @RequirePermission('inventory.view')
  findOne(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.transfersService.findById(id, tenant.tenantId);
  }

  @Post()
  @RequirePermission('inventory.transfer')
  create(@Body() dto: CreateTransferDto, @GetTenant() tenant: TenantContext) {
    return this.transfersService.create(tenant.tenantId, dto);
  }

  @Post(':id/dispatch')
  @RequirePermission('inventory.transfer')
  @HttpCode(HttpStatus.OK)
  dispatch(
    @Param('id') id: string,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.transfersService.dispatch(id, tenant.tenantId, user.sub);
  }

  @Post(':id/receive')
  @RequirePermission('inventory.transfer')
  @HttpCode(HttpStatus.OK)
  receive(
    @Param('id') id: string,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.transfersService.receive(id, tenant.tenantId, user.sub);
  }

  @Post(':id/cancel')
  @RequirePermission('inventory.transfer')
  @HttpCode(HttpStatus.OK)
  cancel(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.transfersService.cancel(id, tenant.tenantId);
  }
}
