import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant-context';
import { ExpenseDepartmentsService } from './expense-departments.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';

// New Expenses domain — Department administration. Route prefix
// `expenses-v2` (not `expenses`) deliberately, to avoid colliding with
// Legacy Expenses' own live `/expenses`/`/expense-categories` routes
// during the coexistence window (Owner Decision, Step 2).
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('expenses-v2/departments')
export class ExpenseDepartmentsController {
  constructor(private readonly service: ExpenseDepartmentsService) {}

  @Get()
  @RequirePermission('expenses.view')
  async findAll(
    @GetTenant() tenant: TenantContext,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.service.findAll(tenant.tenantId, includeInactive === 'true');
  }

  @Post()
  @RequirePermission('expenses.configure')
  async create(
    @GetTenant() tenant: TenantContext,
    @Body() dto: CreateDepartmentDto,
    @Req() req: Request,
  ) {
    const user = req.user as { sub: string };
    return this.service.create(tenant.tenantId, user.sub, dto);
  }

  @Patch(':id')
  @RequirePermission('expenses.configure')
  async update(
    @GetTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body() dto: UpdateDepartmentDto,
  ) {
    return this.service.update(tenant.tenantId, id, dto);
  }

  @Patch(':id/deactivate')
  @RequirePermission('expenses.configure')
  async deactivate(
    @GetTenant() tenant: TenantContext,
    @Param('id') id: string,
  ) {
    return this.service.deactivate(tenant.tenantId, id);
  }
}
