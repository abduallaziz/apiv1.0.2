import { Controller, Get, Post, Delete, Param, Body, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { EmployeeGeofencesService } from './employee-geofences.service';
import { CreateEmployeeGeofenceDto } from './dto/create-employee-geofence.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant-context';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('employee-geofences')
export class EmployeeGeofencesController {
  constructor(private readonly service: EmployeeGeofencesService) {}

  @Get()
  @RequirePermission('hr.manage')
  findAllForUser(@GetTenant() tenant: TenantContext, @Query('user_id', ParseUUIDPipe) userId: string) {
    return this.service.findAllForUser(tenant, userId);
  }

  @Post()
  @RequirePermission('hr.manage')
  create(@GetTenant() tenant: TenantContext, @Body() dto: CreateEmployeeGeofenceDto) {
    return this.service.create(tenant, dto);
  }

  @Delete(':id')
  @RequirePermission('hr.manage')
  remove(@Param('id', ParseUUIDPipe) id: string, @GetTenant() tenant: TenantContext) {
    return this.service.remove(id, tenant);
  }
}
