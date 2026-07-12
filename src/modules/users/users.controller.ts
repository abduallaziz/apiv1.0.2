import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, UseGuards, Request,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ChangeRoleDto } from './dto/change-role.dto';
import { AddRoleDto } from './dto/add-role.dto';
import { SetPermissionOverrideDto } from './dto/set-permission-override.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { AccessControlAdminGuard } from '../access-control/guards/access-control-admin.guard';
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

  @Get(':id/roles')
  @RequirePermission('users.view')
  getUserRoles(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.usersService.getUserRoles(id, tenant);
  }

  @Post(':id/roles')
  @Audit('user.role.added')
  @RequirePermission('users.manage')
  addRole(
    @Param('id') id: string,
    @Body() dto: AddRoleDto,
    @GetTenant() tenant: TenantContext,
    @Request() req: any,
  ) {
    return this.usersService.addRole(id, dto.role_id, tenant, req.user.sub);
  }

  @Delete(':id/roles/:roleId')
  @Audit('user.role.removed')
  @RequirePermission('users.manage')
  removeRole(
    @Param('id') id: string,
    @Param('roleId') roleId: string,
    @GetTenant() tenant: TenantContext,
    @Request() req: any,
  ) {
    return this.usersService.removeRole(id, roleId, tenant, req.user.sub);
  }

  // "Who can manage permissions" is a hardcoded owner/superadmin check
  // (AccessControlAdminGuard), never a customizable users.manage-gated
  // permission — same S5 Stage C decision access-control.controller.ts
  // already applies, so whoever currently holds users.manage could never
  // grant/revoke this access for themselves via the very system it gates.
  @Post(':id/permissions/overrides')
  @Audit('user.permission_override.set')
  @UseGuards(AccessControlAdminGuard)
  setPermissionOverride(
    @Param('id') id: string,
    @Body() dto: SetPermissionOverrideDto,
    @GetTenant() tenant: TenantContext,
    @Request() req: any,
  ) {
    return this.usersService.setPermissionOverride(id, dto.permission_key, dto.action, tenant, req.user.sub);
  }

  @Delete(':id/permissions/overrides')
  @Audit('user.permission_override.removed')
  @UseGuards(AccessControlAdminGuard)
  removePermissionOverride(
    @Param('id') id: string,
    @Body('permission_key') permissionKey: string,
    @GetTenant() tenant: TenantContext,
    @Request() req: any,
  ) {
    return this.usersService.removePermissionOverride(id, permissionKey, tenant, req.user.sub);
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
  @Audit('attendance.link.regenerated')
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