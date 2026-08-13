import { Controller, Get, Post, Patch, Body, Param, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { NonConformancesService } from './non-conformances.service';
import { CreateNonConformanceDto } from './dto/create-non-conformance.dto';
import { UpdateNonConformanceStatusDto } from './dto/update-non-conformance-status.dto';
import { CreateDefectDto } from './dto/create-defect.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { JwtPayload } from '../../shared/types/jwt-payload.type';
import { Audit } from '../../core/audit/audit.decorator';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('quality/non-conformances')
export class NonConformancesController {
  constructor(private readonly nonConformancesService: NonConformancesService) {}

  @Get()
  @RequirePermission('quality.view')
  findAll(@GetTenant() tenant: TenantContext) {
    return this.nonConformancesService.findAll(tenant.tenantId);
  }

  @Get(':id')
  @RequirePermission('quality.view')
  findOne(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.nonConformancesService.findById(id, tenant.tenantId);
  }

  @Get(':id/defects')
  @RequirePermission('quality.view')
  defects(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.nonConformancesService.defects(id, tenant.tenantId);
  }

  @Post()
  @RequirePermission('quality.manage')
  @Audit('non_conformance.created')
  create(@Body() dto: CreateNonConformanceDto, @GetTenant() tenant: TenantContext) {
    return this.nonConformancesService.create(tenant.tenantId, dto);
  }

  @Post(':id/defects')
  @RequirePermission('quality.manage')
  @Audit('non_conformance.defect_added')
  addDefect(@Param('id') id: string, @Body() dto: CreateDefectDto, @GetTenant() tenant: TenantContext) {
    return this.nonConformancesService.addDefect(id, tenant.tenantId, dto);
  }

  // Single endpoint drives the whole lifecycle (investigating -> containment
  // -> corrective_action -> verification -> closed) — the body's `status`
  // determines the transition; the service enforces one-stage-at-a-time.
  @Patch(':id/status')
  @RequirePermission('quality.manage')
  @HttpCode(HttpStatus.OK)
  @Audit('non_conformance.status_changed')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateNonConformanceStatusDto,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.nonConformancesService.updateStatus(id, tenant.tenantId, dto, user.sub);
  }
}
