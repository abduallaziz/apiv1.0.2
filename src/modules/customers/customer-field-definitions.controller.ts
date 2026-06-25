import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CustomerFieldDefinitionsService } from './customer-field-definitions.service';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant-context';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { CreateFieldDefinitionDto } from './dto/create-field-definition.dto';
import { UpdateFieldDefinitionDto } from './dto/update-field-definition.dto';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('customer-field-definitions')
export class CustomerFieldDefinitionsController {
  constructor(private readonly service: CustomerFieldDefinitionsService) {}

  @Get()
  @RequirePermission('customers.view')
  findAll(@GetTenant() tenant: TenantContext) {
    return this.service.findAll(tenant);
  }

  @Post()
  @RequirePermission('customers.manage')
  create(@GetTenant() tenant: TenantContext, @Body() dto: CreateFieldDefinitionDto) {
    return this.service.create(tenant, dto);
  }

  @Patch(':id')
  @RequirePermission('customers.manage')
  update(
    @GetTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body() dto: UpdateFieldDefinitionDto,
  ) {
    return this.service.update(tenant, id, dto);
  }

  @Delete(':id')
  @RequirePermission('customers.manage')
  remove(@GetTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.service.remove(tenant, id);
  }
}
