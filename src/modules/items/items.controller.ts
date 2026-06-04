import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ItemsService } from './items.service';
import { CreateItemDto } from './dto/create-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { CreateVariantDto } from './dto/create-variant.dto';
import { UpdateVariantDto } from './dto/update-variant.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('items')
export class ItemsController {
  constructor(private readonly itemsService: ItemsService) {}

  @Get()
  @RequirePermission('items.view')
  findAll(@GetTenant() tenant: TenantContext) {
    return this.itemsService.findAll(tenant.tenantId);
  }

  @Get(':id')
  @RequirePermission('items.view')
  findOne(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.itemsService.findById(id, tenant.tenantId);
  }

  @Post()
  @RequirePermission('items.manage')
  create(@Body() dto: CreateItemDto, @GetTenant() tenant: TenantContext) {
    return this.itemsService.create(tenant.tenantId, dto);
  }

  @Patch(':id')
  @RequirePermission('items.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateItemDto,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.itemsService.update(id, tenant.tenantId, dto);
  }

  @Delete(':id')
  @RequirePermission('items.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.itemsService.remove(id, tenant.tenantId);
  }

  @Get(':itemId/variants')
  @RequirePermission('items.view')
  findVariants(@Param('itemId') itemId: string, @GetTenant() tenant: TenantContext) {
    return this.itemsService.findVariants(itemId, tenant.tenantId);
  }

  @Post(':itemId/variants')
  @RequirePermission('items.manage')
  createVariant(
    @Param('itemId') itemId: string,
    @Body() dto: CreateVariantDto,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.itemsService.createVariant(itemId, tenant.tenantId, dto);
  }

  @Patch(':itemId/variants/:variantId')
  @RequirePermission('items.manage')
  updateVariant(
    @Param('itemId') itemId: string,
    @Param('variantId') variantId: string,
    @Body() dto: UpdateVariantDto,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.itemsService.updateVariant(variantId, itemId, tenant.tenantId, dto);
  }

  @Delete(':itemId/variants/:variantId')
  @RequirePermission('items.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeVariant(
    @Param('itemId') itemId: string,
    @Param('variantId') variantId: string,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.itemsService.removeVariant(variantId, itemId, tenant.tenantId);
  }
}