import { Controller, Get, Post, Param, Body, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { WmsService } from './wms.service';
import { CreateShipmentDto } from './dto/create-shipment.dto';
import { CreatePickListDto } from './dto/create-pick-list.dto';
import { ConfirmPickDto } from './dto/confirm-pick.dto';
import { ConfirmPackDto } from './dto/confirm-pack.dto';
import { ShipShipmentDto } from './dto/ship-shipment.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { JwtPayload } from '../../shared/types/jwt-payload.type';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('inventory/wms')
export class WmsController {
  constructor(private readonly wmsService: WmsService) {}

  @Get('shipments')
  @RequirePermission('inventory.view')
  findShipments(@Query('status') status: string, @GetTenant() tenant: TenantContext) {
    return this.wmsService.findShipments(tenant.tenantId, status);
  }

  @Get('shipments/:id')
  @RequirePermission('inventory.view')
  findShipment(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.wmsService.findShipmentById(id, tenant.tenantId);
  }

  @Post('shipments')
  @RequirePermission('inventory.fulfill')
  createShipment(@Body() dto: CreateShipmentDto, @GetTenant() tenant: TenantContext) {
    return this.wmsService.createShipment(tenant.tenantId, dto);
  }

  @Post('shipments/:id/cancel')
  @RequirePermission('inventory.fulfill')
  @HttpCode(HttpStatus.OK)
  cancelShipment(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.wmsService.cancelShipment(id, tenant.tenantId);
  }

  @Post('shipments/:id/ship')
  @RequirePermission('inventory.fulfill')
  @HttpCode(HttpStatus.OK)
  shipShipment(
    @Param('id') id: string,
    @Body() dto: ShipShipmentDto,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.wmsService.shipShipment(id, tenant.tenantId, user.sub, dto.tracking_number);
  }

  @Post('shipment-lines/:id/pack')
  @RequirePermission('inventory.fulfill')
  @HttpCode(HttpStatus.OK)
  confirmPack(
    @Param('id') id: string,
    @Body() dto: ConfirmPackDto,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.wmsService.confirmPack(id, tenant.tenantId, dto.quantity, user.sub);
  }

  @Get('pick-lists')
  @RequirePermission('inventory.view')
  findPickLists(@Query('status') status: string, @GetTenant() tenant: TenantContext) {
    return this.wmsService.findPickLists(tenant.tenantId, status);
  }

  @Get('pick-lists/:id')
  @RequirePermission('inventory.view')
  findPickList(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.wmsService.findPickListById(id, tenant.tenantId);
  }

  @Post('pick-lists')
  @RequirePermission('inventory.fulfill')
  createPickList(
    @Body() dto: CreatePickListDto,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.wmsService.createPickList(tenant.tenantId, dto, user.sub);
  }

  @Post('pick-list-lines/:id/pick')
  @RequirePermission('inventory.fulfill')
  @HttpCode(HttpStatus.OK)
  confirmPick(
    @Param('id') id: string,
    @Body() dto: ConfirmPickDto,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.wmsService.confirmPick(id, tenant.tenantId, dto.quantity, user.sub);
  }
}
