import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Request } from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { ExpenseCategoriesService } from './expense-categories.service';

class CreateCategoryDto {
  @IsString()
  @MinLength(1)
  name: string;
}

class UpdateCategoryDto {
  @IsString()
  @MinLength(1)
  name?: string;
  is_active?: boolean;
}

@Controller('expense-categories')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
export class ExpenseCategoriesController {
  constructor(private readonly service: ExpenseCategoriesService) {}

  @Get()
  @RequirePermission('expenses.view')
  findAll(@GetTenant() tenant: TenantContext, @Request() req: any) {
    const tenantId = tenant?.tenantId ?? req.user.tenant_id;
    return this.service.findAll(tenantId);
  }

  @Post()
  @RequirePermission('expenses.manage')
  create(
    @Body() dto: CreateCategoryDto,
    @GetTenant() tenant: TenantContext,
    @Request() req: any,
  ) {
    const tenantId = tenant?.tenantId ?? req.user.tenant_id;
    return this.service.create(tenantId, dto.name);
  }

  @Patch(':id')
  @RequirePermission('expenses.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
    @GetTenant() tenant: TenantContext,
    @Request() req: any,
  ) {
    const tenantId = tenant?.tenantId ?? req.user.tenant_id;
    return this.service.update(id, tenantId, dto);
  }

  @Delete(':id')
  @RequirePermission('expenses.manage')
  remove(
    @Param('id') id: string,
    @GetTenant() tenant: TenantContext,
    @Request() req: any,
  ) {
    const tenantId = tenant?.tenantId ?? req.user.tenant_id;
    return this.service.remove(id, tenantId);
  }
}