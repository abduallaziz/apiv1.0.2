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
import { SuppliersService } from './suppliers.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('purchasing/suppliers')
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Get()
  @RequirePermission('purchasing.view')
  findAll(@GetTenant() tenant: TenantContext) {
    return this.suppliersService.findAll(tenant.tenantId);
  }

  @Get(':id')
  @RequirePermission('purchasing.view')
  findOne(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.suppliersService.findById(id, tenant.tenantId);
  }

  @Get(':id/profile-stats')
  @RequirePermission('purchasing.view')
  findProfileStats(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.suppliersService.findProfileStats(id, tenant.tenantId);
  }

  @Post()
  @RequirePermission('purchasing.manage')
  create(@Body() dto: CreateSupplierDto, @GetTenant() tenant: TenantContext) {
    return this.suppliersService.create(tenant.tenantId, dto);
  }

  @Patch(':id')
  @RequirePermission('purchasing.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSupplierDto,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.suppliersService.update(id, tenant.tenantId, dto);
  }

  @Delete(':id')
  @RequirePermission('purchasing.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.suppliersService.remove(id, tenant.tenantId);
  }
}
