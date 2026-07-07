import { Controller, Post, Body, UseGuards, Request } from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';
import { Audit } from '../../core/audit/audit.decorator';

// Separate from UsersController on purpose: Employee Core creation has no
// email/password/role, so it's a distinct entrypoint rather than an overload
// of POST /users (which remains the System User / login-account creation path).
@Controller('employees')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
export class EmployeesController {
  constructor(private readonly usersService: UsersService) {}

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
}
