import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { TablesService } from './tables.service';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdateTableDto } from './dto/update-table.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant-context';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('tables')
export class TablesController {
  constructor(private readonly service: TablesService) {}

  @Get()
  @RequirePermission('tables.manage')
  findAll(@GetTenant() tenant: TenantContext, @Query('branch_id') branchId?: string) {
    return this.service.findAll(tenant, branchId);
  }

  @Get(':id')
  @RequirePermission('tables.manage')
  findOne(@Param('id', ParseUUIDPipe) id: string, @GetTenant() tenant: TenantContext) {
    return this.service.findOne(id, tenant);
  }

  @Post()
  @RequirePermission('tables.manage')
  create(@GetTenant() tenant: TenantContext, @Body() dto: CreateTableDto) {
    return this.service.create(tenant, dto);
  }

  @Patch(':id')
  @RequirePermission('tables.manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @GetTenant() tenant: TenantContext,
    @Body() dto: UpdateTableDto,
  ) {
    return this.service.update(id, tenant, dto);
  }

  @Delete(':id')
  @RequirePermission('tables.manage')
  remove(@Param('id', ParseUUIDPipe) id: string, @GetTenant() tenant: TenantContext) {
    return this.service.remove(id, tenant);
  }
}
