import { Controller, Get, Post, Body, Param, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { OwnershipService } from './ownership.service';
import { CreateOwnershipLayerDto } from './dto/create-ownership-layer.dto';
import { TransferOwnershipDto } from './dto/transfer-ownership.dto';
import { ReleaseOwnershipDto } from './dto/release-ownership.dto';
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
@Controller('ownership')
export class OwnershipController {
  constructor(private readonly ownershipService: OwnershipService) {}

  @Get()
  @RequirePermission('ownership.view')
  findAll(
    @GetTenant() tenant: TenantContext,
    @Query('status') status?: string,
    @Query('warehouse_id') warehouseId?: string,
    @Query('item_id') itemId?: string,
    @Query('ownership_type') ownershipType?: string,
  ) {
    return this.ownershipService.findAll(tenant.tenantId, {
      status,
      warehouse_id: warehouseId,
      item_id: itemId,
      ownership_type: ownershipType,
    });
  }

  @Get(':id')
  @RequirePermission('ownership.view')
  findOne(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.ownershipService.findById(id, tenant.tenantId);
  }

  @Post()
  @RequirePermission('ownership.manage')
  @Audit('ownership_layer.created')
  create(@Body() dto: CreateOwnershipLayerDto, @GetTenant() tenant: TenantContext, @CurrentUser() user: JwtPayload) {
    return this.ownershipService.create(tenant.tenantId, dto, user.sub);
  }

  @Post(':id/transfer')
  @RequirePermission('ownership.manage')
  @HttpCode(HttpStatus.OK)
  @Audit('ownership_layer.transferred')
  transfer(@Param('id') id: string, @Body() dto: TransferOwnershipDto, @GetTenant() tenant: TenantContext) {
    return this.ownershipService.transfer(id, tenant.tenantId, dto);
  }

  @Post(':id/release')
  @RequirePermission('ownership.manage')
  @HttpCode(HttpStatus.OK)
  @Audit('ownership_layer.released')
  release(@Param('id') id: string, @Body() dto: ReleaseOwnershipDto, @GetTenant() tenant: TenantContext) {
    return this.ownershipService.release(id, tenant.tenantId, dto);
  }
}
