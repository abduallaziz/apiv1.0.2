import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';
import { ExpenseCategoriesService } from './expense-categories.service';
import { IsString, MinLength } from 'class-validator';

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
@UseGuards(JwtAuthGuard, TenantGuard)
export class ExpenseCategoriesController {
  constructor(private readonly service: ExpenseCategoriesService) {}

  @Get()
  findAll(@GetTenant() tenant: TenantContext, @Request() req: any) {
    const tenantId = tenant?.tenantId ?? req.user.tenant_id;
    return this.service.findAll(tenantId);
  }

  @Post()
  create(
    @Body() dto: CreateCategoryDto,
    @GetTenant() tenant: TenantContext,
    @Request() req: any,
  ) {
    const tenantId = tenant?.tenantId ?? req.user.tenant_id;
    return this.service.create(tenantId, dto.name);
  }

  @Patch(':id')
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
  remove(
    @Param('id') id: string,
    @GetTenant() tenant: TenantContext,
    @Request() req: any,
  ) {
    const tenantId = tenant?.tenantId ?? req.user.tenant_id;
    return this.service.remove(id, tenantId);
  }
}