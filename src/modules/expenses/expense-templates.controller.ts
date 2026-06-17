import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, Request } from '@nestjs/common';
import { IsString, IsBoolean, IsNumber, IsOptional, IsIn, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';
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
@UseGuards(JwtAuthGuard, TenantGuard)
export class ExpenseTemplatesController {
  constructor(private readonly service: ExpenseTemplatesService) {}

  @Get()
  findAll(@GetTenant() tenant: TenantContext, @Request() req: any) {
    const tenantId = tenant?.tenantId ?? req.user.tenant_id;
    return this.service.findAll(tenantId);
  }

  @Post()
  create(
    @Body() dto: CreateTemplateDto,
    @GetTenant() tenant: TenantContext,
    @Request() req: any,
  ) {
    const tenantId = tenant?.tenantId ?? req.user.tenant_id;
    return this.service.create(tenantId, dto);
  }

  @Patch(':id')
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
  remove(
    @Param('id') id: string,
    @GetTenant() tenant: TenantContext,
    @Request() req: any,
  ) {
    const tenantId = tenant?.tenantId ?? req.user.tenant_id;
    return this.service.remove(id, tenantId);
  }
}