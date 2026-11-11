import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { ItemPackagingLevelsService } from './item-packaging-levels.service';
import { CreatePackagingLevelDto } from './dto/create-packaging-level.dto';
import { UpdatePackagingLevelDto } from './dto/update-packaging-level.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('item-packaging-levels')
export class ItemPackagingLevelsController {
  constructor(private readonly packagingService: ItemPackagingLevelsService) {}

  @Get()
  @RequirePermission('items.view')
  findAllForItem(
    @Query('item_id') itemId: string,
    @GetTenant() tenant: TenantContext,
  ) {
    if (!itemId) {
      throw new BadRequestException('item_id query parameter is required');
    }
    return this.packagingService.findAllForItem(itemId, tenant.tenantId);
  }

  @Get(':id')
  @RequirePermission('items.view')
  findOne(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.packagingService.findById(id, tenant.tenantId);
  }

  // Preview endpoint the UI calls while a user is defining a hierarchy — no
  // write, just fn_convert_packaging_to_storage_qty via the service, so the
  // form can show "= X Pieces" before the user submits.
  @Get(':id/resolve')
  @RequirePermission('items.view')
  resolve(
    @Param('id') id: string,
    @Query('item_id') itemId: string,
    @Query('quantity') quantity: string,
    @GetTenant() tenant: TenantContext,
  ) {
    if (!itemId) {
      throw new BadRequestException('item_id query parameter is required');
    }
    return this.packagingService
      .resolveQuantity(itemId, id, Number(quantity ?? 1), tenant.tenantId)
      .then((storageQuantity) => ({ storage_quantity: storageQuantity }));
  }

  @Post()
  @RequirePermission('items.manage')
  create(
    @Body() dto: CreatePackagingLevelDto,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.packagingService.create(tenant.tenantId, dto);
  }

  @Patch(':id')
  @RequirePermission('items.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdatePackagingLevelDto,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.packagingService.update(id, tenant.tenantId, dto);
  }

  @Delete(':id')
  @RequirePermission('items.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.packagingService.remove(id, tenant.tenantId);
  }
}
