import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ShiftPatternsService } from './shift-patterns.service';
import { CreateShiftPatternDto, UpdateShiftPatternDto } from './dto/shift-pattern.dto';
import { AssignScheduleDto } from './dto/assign-schedule.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant-context';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('shift-patterns')
export class ShiftPatternsController {
  constructor(private readonly service: ShiftPatternsService) {}

  @Get()
  @RequirePermission('hr.manage')
  findAll(@GetTenant() tenant: TenantContext) {
    return this.service.findAll(tenant);
  }

  @Post()
  @RequirePermission('hr.manage')
  create(@GetTenant() tenant: TenantContext, @Body() dto: CreateShiftPatternDto) {
    return this.service.create(tenant, dto);
  }

  @Patch(':id')
  @RequirePermission('hr.manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @GetTenant() tenant: TenantContext,
    @Body() dto: UpdateShiftPatternDto,
  ) {
    return this.service.update(id, tenant, dto);
  }

  @Delete(':id')
  @RequirePermission('hr.manage')
  remove(@Param('id', ParseUUIDPipe) id: string, @GetTenant() tenant: TenantContext) {
    return this.service.remove(id, tenant);
  }

  @Post('assign')
  @RequirePermission('hr.manage')
  assign(@GetTenant() tenant: TenantContext, @Body() dto: AssignScheduleDto) {
    return this.service.assign(tenant, dto);
  }
}
