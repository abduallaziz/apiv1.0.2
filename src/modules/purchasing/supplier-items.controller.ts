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
import { SupplierItemsService } from './supplier-items.service';
import { CreateSupplierItemDto } from './dto/create-supplier-item.dto';
import { UpdateSupplierItemDto } from './dto/update-supplier-item.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';
import { Audit } from '../../core/audit/audit.decorator';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('purchasing/suppliers/:supplierId/items')
export class SupplierItemsController {
  constructor(private readonly supplierItemsService: SupplierItemsService) {}

  @Get()
  @RequirePermission('purchasing.view')
  findAll(
    @Param('supplierId') supplierId: string,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.supplierItemsService.findAll(tenant.tenantId, supplierId);
  }

  @Get(':id')
  @RequirePermission('purchasing.view')
  findOne(
    @Param('supplierId') supplierId: string,
    @Param('id') id: string,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.supplierItemsService.findById(id, tenant.tenantId, supplierId);
  }

  @Post()
  @RequirePermission('purchasing.manage')
  @Audit('supplier_item.created')
  create(
    @Param('supplierId') supplierId: string,
    @Body() dto: CreateSupplierItemDto,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.supplierItemsService.create(tenant.tenantId, supplierId, dto);
  }

  @Patch(':id')
  @RequirePermission('purchasing.manage')
  @Audit('supplier_item.updated')
  update(
    @Param('supplierId') supplierId: string,
    @Param('id') id: string,
    @Body() dto: UpdateSupplierItemDto,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.supplierItemsService.update(
      id,
      tenant.tenantId,
      supplierId,
      dto,
    );
  }

  @Delete(':id')
  @RequirePermission('purchasing.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit('supplier_item.deleted')
  remove(
    @Param('supplierId') supplierId: string,
    @Param('id') id: string,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.supplierItemsService.remove(id, tenant.tenantId, supplierId);
  }
}
