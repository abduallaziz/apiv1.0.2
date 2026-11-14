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
import { ItemAttributesService } from './item-attributes.service';
import { CreateItemAttributeDto } from './dto/create-item-attribute.dto';
import { UpdateItemAttributeDto } from './dto/update-item-attribute.dto';
import { CreateItemAttributeValueDto } from './dto/create-item-attribute-value.dto';
import { UpdateItemAttributeValueDto } from './dto/update-item-attribute-value.dto';
import { AssignVariantAttributeDto } from './dto/assign-variant-attribute.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';
import { isolatedBranchId } from '../../core/tenant/branch-scope-id.util';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('item-attributes')
export class ItemAttributesController {
  constructor(private readonly attributesService: ItemAttributesService) {}

  @Get()
  @RequirePermission('items.view')
  findAll(@GetTenant() tenant: TenantContext) {
    return this.attributesService.findAllAttributes(
      tenant.tenantId,
      isolatedBranchId(tenant),
    );
  }

  @Get(':id')
  @RequirePermission('items.view')
  findOne(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.attributesService.findAttributeById(
      id,
      tenant.tenantId,
      isolatedBranchId(tenant),
    );
  }

  // Must be registered before the value-scoped route below to avoid a
  // routing conflict with ':id' — same ordering rule already established
  // by ItemBarcodesController's 'lookup/:barcode'.
  @Get(':id/values')
  @RequirePermission('items.view')
  findValues(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.attributesService.findValues(
      id,
      tenant.tenantId,
      isolatedBranchId(tenant),
    );
  }

  @Post()
  @RequirePermission('items.manage')
  create(
    @Body() dto: CreateItemAttributeDto,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.attributesService.createAttribute(
      tenant.tenantId,
      dto,
      isolatedBranchId(tenant),
    );
  }

  @Patch(':id')
  @RequirePermission('items.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateItemAttributeDto,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.attributesService.updateAttribute(
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
    return this.attributesService.removeAttribute(
      id,
      tenant.tenantId,
      isolatedBranchId(tenant),
    );
  }

  // -- Values (top-level, not nested under /item-attributes/:id) --------------
  // Mirrors item-barcodes' own flat-resource style — a value's parent is
  // referenced by item_attribute_id in the body/query, not the URL.

  @Post('values')
  @RequirePermission('items.manage')
  createValue(
    @Body() dto: CreateItemAttributeValueDto,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.attributesService.createValue(
      tenant.tenantId,
      dto,
      isolatedBranchId(tenant),
    );
  }

  @Patch('values/:id')
  @RequirePermission('items.manage')
  updateValue(
    @Param('id') id: string,
    @Body() dto: UpdateItemAttributeValueDto,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.attributesService.updateValue(
      id,
      tenant.tenantId,
      dto,
      isolatedBranchId(tenant),
    );
  }

  @Delete('values/:id')
  @RequirePermission('items.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeValue(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.attributesService.removeValue(
      id,
      tenant.tenantId,
      isolatedBranchId(tenant),
    );
  }

  // -- Variant assignments ------------------------------------------------------

  @Get('variant-assignments/:variantId')
  @RequirePermission('items.view')
  findAssignments(
    @Param('variantId') variantId: string,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.attributesService.findAssignmentsForVariant(
      variantId,
      tenant.tenantId,
      isolatedBranchId(tenant),
    );
  }

  @Post('variant-assignments')
  @RequirePermission('items.manage')
  assign(
    @Body() dto: AssignVariantAttributeDto,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.attributesService.assignToVariant(
      tenant.tenantId,
      dto,
      isolatedBranchId(tenant),
    );
  }

  @Delete('variant-assignments/:id')
  @RequirePermission('items.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeAssignment(
    @Param('id') id: string,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.attributesService.removeAssignment(
      id,
      tenant.tenantId,
      isolatedBranchId(tenant),
    );
  }
}
