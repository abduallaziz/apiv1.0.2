import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';
import { Audit } from '../../core/audit/audit.decorator';

// Separate from UsersController on purpose: Employee Core creation/editing has
// no email/password/role, so it's a distinct entrypoint rather than an overload
// of /users (which remains the System User / login-account path).
@Controller('employees')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
export class EmployeesController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @RequirePermission('users.view')
  findAll(@GetTenant() tenant: TenantContext) {
    return this.usersService.findAllEmployees(tenant);
  }

  @Get('linkable-users')
  @RequirePermission('users.view')
  findLinkable(@GetTenant() tenant: TenantContext) {
    return this.usersService.findLinkableSystemUsers(tenant);
  }

  @Get('check-duplicate')
  @RequirePermission('users.view')
  checkDuplicate(
    @GetTenant() tenant: TenantContext,
    @Query('email') email?: string,
    @Query('phone') phone?: string,
    @Query('employee_number') employee_number?: string,
    @Query('exclude_id') excludeId?: string,
  ) {
    return this.usersService.checkDuplicates(tenant, { email, phone, employee_number }, excludeId);
  }

  @Get(':id/history')
  @RequirePermission('users.view')
  findHistory(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.usersService.findEmployeeHistory(id, tenant);
  }

  @Post()
  @Audit('employee.created')
  @RequirePermission('users.manage')
  create(
    @Body() dto: CreateEmployeeDto,
    @GetTenant() tenant: TenantContext,
    @Request() req: any,
  ) {
    return this.usersService.createEmployee(dto, tenant, req.user.sub);
  }

  @Post(':id/link')
  @Audit('employee.linked')
  @RequirePermission('users.manage')
  link(
    @Param('id') id: string,
    @GetTenant() tenant: TenantContext,
    @Request() req: any,
  ) {
    return this.usersService.linkAsEmployee(id, tenant, req.user.sub);
  }

  @Patch(':id')
  @Audit('employee.updated')
  @RequirePermission('users.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeDto,
    @GetTenant() tenant: TenantContext,
    @Request() req: any,
  ) {
    return this.usersService.updateEmployee(id, dto, tenant, req.user.sub);
  }
}
