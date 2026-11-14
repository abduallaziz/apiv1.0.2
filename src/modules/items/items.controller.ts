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
} from '@nestjs/common';
import { ItemsService } from './items.service';
import { CreateItemDto } from './dto/create-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { CreateVariantDto } from './dto/create-variant.dto';
import { UpdateVariantDto } from './dto/update-variant.dto';
import { QueryItemsDto } from './dto/query-items.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';
import { isolatedBranchId } from '../../core/tenant/branch-scope-id.util';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('items')
export class ItemsController {
  constructor(private readonly itemsService: ItemsService) {}

  @Get()
  @RequirePermission('items.view')
  findAll(@GetTenant() tenant: TenantContext, @Query() query: QueryItemsDto) {
    return this.itemsService.findAll(
      tenant.tenantId,
      query,
      isolatedBranchId(tenant),
    );
  }

  // Registered before ':id' — otherwise Nest would route GET /items/stats
  // into the :id handler with id="stats" (same gotcha documented elsewhere
  // in this codebase, e.g. invoices' held/:id vs :id).
  @Get('stats')
  @RequirePermission('items.view')
  getStats(@GetTenant() tenant: TenantContext) {
    return this.itemsService.getStats(
      tenant.tenantId,
      isolatedBranchId(tenant),
    );
  }

  @Get(':id')
  @RequirePermission('items.view')
  findOne(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.itemsService.findById(
      id,
      tenant.tenantId,
      isolatedBranchId(tenant),
    );
  }

  @Post()
  @RequirePermission('items.manage')
  create(@Body() dto: CreateItemDto, @GetTenant() tenant: TenantContext) {
    return this.itemsService.create(
      tenant.tenantId,
      dto,
      isolatedBranchId(tenant),
    );
  }

  @Patch(':id')
  @RequirePermission('items.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateItemDto,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.itemsService.update(
      id,
      tenant.tenantId,
      dto,
      isolatedBranchId(tenant),
    );
  }

  @Delete(':id')
  @RequirePermission('items.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.itemsService.remove(
      id,
      tenant.tenantId,
      isolatedBranchId(tenant),
    );
  }

  @Get(':itemId/variants')
  @RequirePermission('items.view')
  findVariants(
    @Param('itemId') itemId: string,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.itemsService.findVariants(
      itemId,
      tenant.tenantId,
      isolatedBranchId(tenant),
    );
  }

  @Post(':itemId/variants')
  @RequirePermission('items.manage')
  createVariant(
    @Param('itemId') itemId: string,
    @Body() dto: CreateVariantDto,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.itemsService.createVariant(
      itemId,
      tenant.tenantId,
      dto,
      isolatedBranchId(tenant),
    );
  }

  @Patch(':itemId/variants/:variantId')
  @RequirePermission('items.manage')
  updateVariant(
    @Param('itemId') itemId: string,
    @Param('variantId') variantId: string,
    @Body() dto: UpdateVariantDto,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.itemsService.updateVariant(
      variantId,
      itemId,
      tenant.tenantId,
      dto,
      isolatedBranchId(tenant),
    );
  }

  @Delete(':itemId/variants/:variantId')
  @RequirePermission('items.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeVariant(
    @Param('itemId') itemId: string,
    @Param('variantId') variantId: string,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.itemsService.removeVariant(
      variantId,
      itemId,
      tenant.tenantId,
      isolatedBranchId(tenant),
    );
  }
}
