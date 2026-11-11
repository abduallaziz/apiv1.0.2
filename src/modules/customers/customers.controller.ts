import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
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
import {
  CreateVehicleDto,
  CustomerLookupQueryDto,
  CustomerStatsQueryDto,
  UpdateVehicleDto,
} from './dto/customer-lookup.dto';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { JwtPayload } from '../../shared/types/jwt-payload.type';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('customers')
export class CustomersController {
  constructor(private readonly service: CustomersService) {}

  @Get('stats')
  @RequirePermission('customers.view')
  getStats(
    @GetTenant() tenant: TenantContext,
    @Query() query: CustomerStatsQueryDto,
  ) {
    return this.service.getStats(tenant, query.from, query.to);
  }

  @Get()
  @RequirePermission('customers.view')
  findAll(
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Query() query: CustomerQueryDto,
  ) {
    return this.service.findAll(tenant, user, query);
  }

  @Get('lookup')
  @RequirePermission('customers.view')
  lookup(
    @GetTenant() tenant: TenantContext,
    @Query() query: CustomerLookupQueryDto,
  ) {
    return this.service.lookup(tenant, query);
  }

  @Get(':id/vehicles')
  @RequirePermission('customers.view')
  listVehicles(
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.service.listVehicles(tenant, user, id);
  }

  @Post(':id/vehicles')
  @RequirePermission('customers.update')
  addVehicle(
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: CreateVehicleDto,
  ) {
    return this.service.addVehicle(tenant, user, id, dto);
  }

  @Patch(':id/vehicles/:vehicleId')
  @RequirePermission('customers.update')
  updateVehicle(
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('vehicleId') vehicleId: string,
    @Body() dto: UpdateVehicleDto,
  ) {
    return this.service.updateVehicle(tenant, user, id, vehicleId, dto);
  }

  @Delete(':id/vehicles/:vehicleId')
  @RequirePermission('customers.update')
  removeVehicle(
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('vehicleId') vehicleId: string,
  ) {
    return this.service.removeVehicle(tenant, user, id, vehicleId);
  }

  @Get(':id')
  @RequirePermission('customers.view')
  findOne(
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.service.findById(tenant, user, id);
  }

  @Post()
  @RequirePermission('customers.create')
  create(
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateCustomerDto,
  ) {
    return this.service.create(tenant, user, dto);
  }

  @Patch(':id')
  @RequirePermission('customers.update')
  update(
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.service.update(tenant, user, id, dto);
  }

  @Delete(':id')
  @RequirePermission('customers.archive')
  remove(
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.service.remove(tenant, user, id);
  }

  @Get(':id/history')
  @RequirePermission('customers.view')
  getHistory(
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.service.getHistory(tenant, user, id);
  }
}
