import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, Request } from '@nestjs/common';
import { IsString, IsBoolean, IsNumber, IsOptional, IsIn, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { ExpenseTemplatesService } from './expense-templates.service';

class CreateTemplateDto {
  @IsString() @MinLength(1) name: string;
  @IsOptional() @IsNumber() default_amount?: number | null;
  @IsOptional() @IsNumber() expiry_hours?: number;
  @IsOptional() @IsBoolean() requires_photo?: boolean;
}

class UpdateTemplateDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsNumber() default_amount?: number | null;
  @IsOptional() @IsBoolean() requires_photo?: boolean;
  @IsOptional() @IsNumber() expiry_hours?: number;
  @IsOptional() @IsBoolean() is_active?: boolean;
  @IsOptional() @IsBoolean() is_pre_approved?: boolean;
  @IsOptional() @IsString() @IsIn(['none','daily','weekly','monthly']) recurrence_type?: string;
  @IsOptional() @IsNumber() recurrence_day?: number | null;
  @IsOptional() @IsString() next_run_at?: string | null;
}

@Controller('expense-templates')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
export class ExpenseTemplatesController {
  constructor(private readonly service: ExpenseTemplatesService) {}

  @Get()
  @RequirePermission('expenses.view')
  findAll(@GetTenant() tenant: TenantContext, @Request() req: any) {
    const tenantId = tenant?.tenantId ?? req.user.tenant_id;
    return this.service.findAll(tenantId);
  }

  @Post()
  @RequirePermission('expenses.manage')
  create(
    @Body() dto: CreateTemplateDto,
    @GetTenant() tenant: TenantContext,
    @Request() req: any,
  ) {
    const tenantId = tenant?.tenantId ?? req.user.tenant_id;
    return this.service.create(tenantId, dto);
  }

  @Patch(':id')
  @RequirePermission('expenses.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTemplateDto,
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