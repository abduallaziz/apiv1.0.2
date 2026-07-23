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
import { ItemBarcodesService } from './item-barcodes.service';
import { CreateItemBarcodeDto } from './dto/create-item-barcode.dto';
import { UpdateItemBarcodeDto } from './dto/update-item-barcode.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('item-barcodes')
export class ItemBarcodesController {
  constructor(private readonly barcodesService: ItemBarcodesService) {}

  @Get()
  @RequirePermission('items.view')
  findAll(
    @GetTenant() tenant: TenantContext,
    @Query('item_id') itemId?: string,
    @Query('variant_id') variantId?: string,
  ) {
    return this.barcodesService.findAll(tenant.tenantId, itemId, variantId);
  }

  // Must be registered before ':id' — otherwise Nest would route
  // GET /item-barcodes/lookup/XXXX into the :id handler instead.
  @Get('lookup/:barcode')
  @RequirePermission('items.view')
  lookup(@Param('barcode') barcode: string, @GetTenant() tenant: TenantContext) {
    return this.barcodesService.lookup(barcode, tenant.tenantId);
  }

  @Get(':id')
  @RequirePermission('items.view')
  findOne(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.barcodesService.findById(id, tenant.tenantId);
  }

  @Post()
  @RequirePermission('items.manage')
  create(
    @Body() dto: CreateItemBarcodeDto,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.barcodesService.create(tenant.tenantId, dto);
  }

  @Patch(':id')
  @RequirePermission('items.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateItemBarcodeDto,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.barcodesService.update(id, tenant.tenantId, dto);
  }

  @Delete(':id')
  @RequirePermission('items.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.barcodesService.remove(id, tenant.tenantId);
  }
}
