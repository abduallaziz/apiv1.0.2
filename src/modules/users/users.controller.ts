import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, UseGuards, Request,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ChangeRoleDto } from './dto/change-role.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';
import { Audit } from '../../core/audit/audit.decorator';

@Controller('users')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @RequirePermission('users.view')
  findAll(@GetTenant() tenant: TenantContext) {
    return this.usersService.findAll(tenant);
  }

  @Get(':id')
  @RequirePermission('users.view')
  findOne(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.usersService.findOne(id, tenant);
  }

  @Post()
  @Audit('employee.created')
  @RequirePermission('users.manage')
  create(
    @Body() dto: CreateUserDto,
    @GetTenant() tenant: TenantContext,
    @Request() req: any,
  ) {
    return this.usersService.create(dto, tenant, req.user.sub);
  }

  @Patch(':id')
  @Audit('employee.updated')
  @RequirePermission('users.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @GetTenant() tenant: TenantContext,
    @Request() req: any,
  ) {
    return this.usersService.update(id, dto, tenant, req.user.sub);
  }

  @Patch(':id/role')
  @Audit('employee.role.changed')
  @RequirePermission('users.manage')
  changeRole(
    @Param('id') id: string,
    @Body() dto: ChangeRoleDto,
    @GetTenant() tenant: TenantContext,
    @Request() req: any,
  ) {
    return this.usersService.changeRole(id, dto, tenant, req.user.sub);
  }

  @Delete(':id')
  @RequirePermission('users.manage')
  remove(
    @Param('id') id: string,
    @GetTenant() tenant: TenantContext,
    @Request() req: any,
  ) {
    return this.usersService.remove(id, tenant, req.user.sub);
  }

  @Post(':id/attendance-link')
  @RequirePermission('hr.manage')
  generateAttendanceLink(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.usersService.generateAttendanceLink(id, tenant);
  }

  @Post(':id/attendance-link/unbind-device')
  @Audit('attendance.link.device.unbound')
  @RequirePermission('hr.manage')
  unbindAttendanceDevice(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.usersService.unbindAttendanceDevice(id, tenant);
  }
}