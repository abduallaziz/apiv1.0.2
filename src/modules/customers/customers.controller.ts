import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { CustomersService } from './customers.service';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant-context';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { CustomerQueryDto } from './dto/customer-query.dto';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('customers')
export class CustomersController {
  constructor(private readonly service: CustomersService) {}

  @Get('stats')
  @RequirePermission('customers.view')
  getStats(@GetTenant() tenant: TenantContext) {
    return this.service.getStats(tenant);
  }

  @Get()
  @RequirePermission('customers.view')
  findAll(@GetTenant() tenant: TenantContext, @Query() query: CustomerQueryDto) {
    return this.service.findAll(tenant, query);
  }

  @Get(':id')
  @RequirePermission('customers.view')
  findOne(@GetTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.service.findById(tenant, id);
  }

  @Post()
  @RequirePermission('customers.manage')
  create(@GetTenant() tenant: TenantContext, @Body() dto: CreateCustomerDto) {
    return this.service.create(tenant, dto);
  }

  @Patch(':id')
  @RequirePermission('customers.manage')
  update(
    @GetTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.service.update(tenant, id, dto);
  }

  @Delete(':id')
  @RequirePermission('customers.manage')
  remove(@GetTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.service.remove(tenant, id);
  }

  @Get(':id/history')
  @RequirePermission('customers.view')
  getHistory(@GetTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.service.getHistory(tenant, id);
  }
}