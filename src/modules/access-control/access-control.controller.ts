import {
  Controller,
  Get,
  Patch,
  Delete,
  Post,
  Param,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import { AccessControlService } from './access-control.service';
import { UpdateRolePermissionDto } from './dto/update-role-permission.dto';
import { CreateRoleDto } from './dto/create-role.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { AccessControlAdminGuard } from './guards/access-control-admin.guard';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant-context';
import { JwtPayload } from '../../shared/types/jwt-payload.type';

// Deliberately NOT using @RequirePermission()/PermissionGuard — per S5 Stage C
// approved decision #1, "who can manage permissions" is a hardcoded
// owner/superadmin check (AccessControlAdminGuard), never a customizable
// permission that could be granted/revoked through the very system it gates.
@UseGuards(JwtAuthGuard, TenantGuard, AccessControlAdminGuard)
@Controller('access-control')
export class AccessControlController {
  constructor(private readonly service: AccessControlService) {}

  @Get('permission-groups')
  listPermissionGroups() {
    return this.service.listPermissionGroups();
  }

  @Get('permissions')
  listPermissions(@Req() req: { user: JwtPayload }) {
    return this.service.listPermissions(req.user);
  }

  @Get('roles')
  listRoles(@GetTenant() tenant: TenantContext) {
    return this.service.listRoles(tenant);
  }

  @Get('roles/:roleId/users')
  getUsersByRole(
    @Param('roleId') roleId: string,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.service.getUsersByRole(roleId, tenant);
  }

  @Post('roles')
  createRole(
    @Body() dto: CreateRoleDto,
    @GetTenant() tenant: TenantContext,
    @Req() req: { user: JwtPayload },
  ) {
    return this.service.createRole(dto.name, dto.description ?? null, tenant, req.user);
  }

  @Delete('roles/:roleId')
  deleteRole(
    @Param('roleId') roleId: string,
    @GetTenant() tenant: TenantContext,
    @Req() req: { user: JwtPayload },
  ) {
    return this.service.deleteRole(roleId, tenant, req.user);
  }

  @Get('roles/:roleId/permissions')
  getRolePermissions(
    @Param('roleId') roleId: string,
    @GetTenant() tenant: TenantContext,
    @Req() req: { user: JwtPayload },
  ) {
    return this.service.getRolePermissions(roleId, tenant, req.user);
  }

  @Patch('roles/:roleId/permissions/:permissionKey')
  updatePermission(
    @Param('roleId') roleId: string,
    @Param('permissionKey') permissionKey: string,
    @Body() dto: UpdateRolePermissionDto,
    @GetTenant() tenant: TenantContext,
    @Req() req: { user: JwtPayload },
  ) {
    return this.service.updatePermission(roleId, permissionKey, dto.is_granted, tenant, req.user);
  }

  @Delete('roles/:roleId/permissions/:permissionKey')
  resetPermission(
    @Param('roleId') roleId: string,
    @Param('permissionKey') permissionKey: string,
    @GetTenant() tenant: TenantContext,
    @Req() req: { user: JwtPayload },
  ) {
    return this.service.resetPermission(roleId, permissionKey, tenant, req.user);
  }

  @Post('roles/:roleId/reset')
  resetRole(
    @Param('roleId') roleId: string,
    @GetTenant() tenant: TenantContext,
    @Req() req: { user: JwtPayload },
  ) {
    return this.service.resetRole(roleId, tenant, req.user);
  }
}
