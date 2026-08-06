import { Controller, Get, Post, Patch, Put, Body, Param, Query, UseGuards } from '@nestjs/common';
import { BomService } from './bom.service';
import { CreateBomDto } from './dto/create-bom.dto';
import { UpdateBomDto } from './dto/update-bom.dto';
import { ReplaceBomLinesDto } from './dto/replace-bom-lines.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';
import { Audit } from '../../core/audit/audit.decorator';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('manufacturing/bom')
export class BomController {
  constructor(private readonly bomService: BomService) {}

  @Get()
  @RequirePermission('manufacturing.view')
  findAll(
    @GetTenant() tenant: TenantContext,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('item_id') itemId?: string,
    @Query('is_active') isActive?: string,
  ) {
    return this.bomService.findAll(tenant.tenantId, page, perPage, itemId, isActive);
  }

  @Get(':id')
  @RequirePermission('manufacturing.view')
  findOne(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.bomService.findById(id, tenant.tenantId);
  }

  @Post()
  @RequirePermission('manufacturing.manage')
  @Audit('bom.created')
  create(@Body() dto: CreateBomDto, @GetTenant() tenant: TenantContext) {
    return this.bomService.create(tenant.tenantId, dto);
  }

  @Patch(':id')
  @RequirePermission('manufacturing.manage')
  @Audit('bom.updated')
  update(@Param('id') id: string, @Body() dto: UpdateBomDto, @GetTenant() tenant: TenantContext) {
    return this.bomService.update(id, tenant.tenantId, dto);
  }

  @Put(':id/lines')
  @RequirePermission('manufacturing.manage')
  replaceLines(
    @Param('id') id: string,
    @Body() dto: ReplaceBomLinesDto,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.bomService.replaceLines(id, tenant.tenantId, dto);
  }

  @Post(':id/activate')
  @RequirePermission('manufacturing.manage')
  @Audit('bom.activated')
  activate(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.bomService.activate(id, tenant.tenantId);
  }

  @Post(':id/deactivate')
  @RequirePermission('manufacturing.manage')
  @Audit('bom.deactivated')
  deactivate(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.bomService.deactivate(id, tenant.tenantId);
  }
}
