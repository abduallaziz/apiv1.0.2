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
import { ExpenseCategoriesV2Service } from './expense-categories-v2.service';
import { CreateExpenseCategoryDto } from './dto/create-category.dto';
import { UpdateExpenseCategoryDto } from './dto/update-category.dto';

// New Expenses domain — Category administration. `categories` (not
// `expense-categories`) under the `expenses-v2` prefix, since Legacy
// already owns the `/expense-categories` route.
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('expenses-v2/categories')
export class ExpenseCategoriesV2Controller {
  constructor(private readonly service: ExpenseCategoriesV2Service) {}

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
    @Body() dto: CreateExpenseCategoryDto,
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
    @Body() dto: UpdateExpenseCategoryDto,
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
