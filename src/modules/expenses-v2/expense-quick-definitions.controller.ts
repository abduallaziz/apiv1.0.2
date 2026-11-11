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
import { ExpenseQuickDefinitionsService } from './expense-quick-definitions.service';
import { CreateQuickDefinitionDto } from './dto/create-quick-definition.dto';
import { UpdateQuickDefinitionDto } from './dto/update-quick-definition.dto';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('expenses-v2/quick-definitions')
export class ExpenseQuickDefinitionsController {
  constructor(private readonly service: ExpenseQuickDefinitionsService) {}

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
    @Body() dto: CreateQuickDefinitionDto,
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
    @Body() dto: UpdateQuickDefinitionDto,
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
