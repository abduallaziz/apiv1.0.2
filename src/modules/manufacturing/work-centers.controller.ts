import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { WorkCentersService } from './work-centers.service';
import { CreateWorkCenterDto } from './dto/create-work-center.dto';
import { UpdateWorkCenterDto } from './dto/update-work-center.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';
import { Audit } from '../../core/audit/audit.decorator';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('manufacturing/work-centers')
export class WorkCentersController {
  constructor(private readonly workCentersService: WorkCentersService) {}

  @Get()
  @RequirePermission('manufacturing.view')
  findAll(@GetTenant() tenant: TenantContext) {
    return this.workCentersService.findAll(tenant.tenantId);
  }

  @Get(':id')
  @RequirePermission('manufacturing.view')
  findOne(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.workCentersService.findById(id, tenant.tenantId);
  }

  @Post()
  @RequirePermission('manufacturing.manage')
  @Audit('work_center.created')
  create(@Body() dto: CreateWorkCenterDto, @GetTenant() tenant: TenantContext) {
    return this.workCentersService.create(tenant.tenantId, dto);
  }

  @Patch(':id')
  @RequirePermission('manufacturing.manage')
  @Audit('work_center.updated')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateWorkCenterDto,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.workCentersService.update(id, tenant.tenantId, dto);
  }

  @Post(':id/activate')
  @RequirePermission('manufacturing.manage')
  activate(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.workCentersService.activate(id, tenant.tenantId);
  }

  @Post(':id/deactivate')
  @RequirePermission('manufacturing.manage')
  deactivate(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.workCentersService.deactivate(id, tenant.tenantId);
  }
}
