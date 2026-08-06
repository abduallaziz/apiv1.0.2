import { Controller, Get, Post, Patch, Body, Param, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { InspectionsService } from './inspections.service';
import { CreateInspectionDto } from './dto/create-inspection.dto';
import { CompleteInspectionDto } from './dto/complete-inspection.dto';
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
@Controller('quality/inspections')
export class InspectionsController {
  constructor(private readonly inspectionsService: InspectionsService) {}

  @Get()
  @RequirePermission('quality.view')
  findAll(@GetTenant() tenant: TenantContext) {
    return this.inspectionsService.findAll(tenant.tenantId);
  }

  @Get(':id')
  @RequirePermission('quality.view')
  findOne(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.inspectionsService.findById(id, tenant.tenantId);
  }

  @Post()
  @RequirePermission('quality.manage')
  @Audit('quality_inspection.created')
  create(@Body() dto: CreateInspectionDto, @GetTenant() tenant: TenantContext, @CurrentUser() user: JwtPayload) {
    return this.inspectionsService.create(tenant.tenantId, dto, user.sub);
  }

  @Patch(':id/complete')
  @RequirePermission('quality.manage')
  @HttpCode(HttpStatus.OK)
  @Audit('quality_inspection.completed')
  complete(
    @Param('id') id: string,
    @Body() dto: CompleteInspectionDto,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.inspectionsService.complete(id, tenant.tenantId, dto);
  }
}
