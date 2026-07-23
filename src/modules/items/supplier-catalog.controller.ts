import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SupplierCatalogService } from './supplier-catalog.service';
import { CreateSupplierCatalogDto } from './dto/create-supplier-catalog.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';
import type { Express } from 'express';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('supplier-catalog')
export class SupplierCatalogController {
  constructor(private readonly catalogService: SupplierCatalogService) {}

  @Get()
  @RequirePermission('items.view')
  findAll(
    @GetTenant() tenant: TenantContext,
    @Query('supplier_id') supplierId?: string,
  ) {
    return this.catalogService.findAll(tenant.tenantId, supplierId);
  }

  @Get(':id')
  @RequirePermission('items.view')
  findOne(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.catalogService.findById(id, tenant.tenantId);
  }

  @Post()
  @RequirePermission('items.manage')
  create(
    @Body() dto: CreateSupplierCatalogDto,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.catalogService.create(tenant.tenantId, dto);
  }

  @Post('import')
  @RequirePermission('items.manage')
  @UseInterceptors(FileInterceptor('file'))
  importCsv(
    @UploadedFile() file: Express.Multer.File,
    @GetTenant() tenant: TenantContext,
  ) {
    if (!file)
      throw new BadRequestException(
        'No file uploaded (expected multipart field "file")',
      );
    return this.catalogService.importFromCsv(
      tenant.tenantId,
      file.buffer.toString('utf-8'),
    );
  }

  // Explicit promotion of one supplier_catalog row into a real
  // item_barcodes row — never automatic, see SupplierCatalogService.sync().
  @Post(':id/sync')
  @RequirePermission('items.manage')
  sync(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.catalogService.sync(id, tenant.tenantId);
  }

  @Delete(':id')
  @RequirePermission('items.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.catalogService.remove(id, tenant.tenantId);
  }
}
