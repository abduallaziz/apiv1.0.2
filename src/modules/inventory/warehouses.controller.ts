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
import { WarehousesService } from './warehouses.service';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('inventory/warehouses')
export class WarehousesController {
  constructor(private readonly warehousesService: WarehousesService) {}

  @Get()
  @RequirePermission('inventory.view')
  findAll(@GetTenant() tenant: TenantContext) {
    return this.warehousesService.findAll(tenant.tenantId);
  }

  @Get(':id')
  @RequirePermission('inventory.view')
  findOne(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.warehousesService.findById(id, tenant.tenantId);
  }

  @Post()
  @RequirePermission('inventory.manage')
  create(@Body() dto: CreateWarehouseDto, @GetTenant() tenant: TenantContext) {
    return this.warehousesService.create(tenant.tenantId, dto);
  }

  @Patch(':id')
  @RequirePermission('inventory.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateWarehouseDto,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.warehousesService.update(id, tenant.tenantId, dto);
  }

  @Delete(':id')
  @RequirePermission('inventory.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.warehousesService.remove(id, tenant.tenantId);
  }
}
