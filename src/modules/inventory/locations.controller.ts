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
import { LocationsService } from './locations.service';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';
import { Audit } from '../../core/audit/audit.decorator';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('inventory/warehouses/:warehouseId/locations')
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) {}

  @Get()
  @RequirePermission('inventory.view')
  findAll(
    @Param('warehouseId') warehouseId: string,
    @GetTenant() tenant: TenantContext,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: 'asc' | 'desc',
    @Query('isActive') isActive?: string,
  ) {
    return this.locationsService.findAll(warehouseId, tenant.tenantId, {
      search,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      sortBy,
      sortOrder,
      isActive: isActive === undefined ? undefined : isActive === 'true',
    });
  }

  @Get(':id')
  @RequirePermission('inventory.view')
  findOne(
    @Param('id') id: string,
    @Param('warehouseId') warehouseId: string,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.locationsService.findById(id, warehouseId, tenant.tenantId);
  }

  @Post()
  @RequirePermission('inventory.manage')
  @Audit('location.create')
  create(
    @Param('warehouseId') warehouseId: string,
    @Body() dto: CreateLocationDto,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.locationsService.create(warehouseId, tenant.tenantId, dto);
  }

  @Patch(':id')
  @RequirePermission('inventory.manage')
  @Audit('location.update')
  update(
    @Param('id') id: string,
    @Param('warehouseId') warehouseId: string,
    @Body() dto: UpdateLocationDto,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.locationsService.update(id, warehouseId, tenant.tenantId, dto);
  }

  @Delete(':id')
  @RequirePermission('inventory.manage')
  @Audit('location.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id') id: string,
    @Param('warehouseId') warehouseId: string,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.locationsService.remove(id, warehouseId, tenant.tenantId);
  }
}
