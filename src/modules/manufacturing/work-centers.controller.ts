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
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { JwtPayload } from '../../shared/types/jwt-payload.type';

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
  create(
    @Body() dto: CreateWorkCenterDto,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.workCentersService.create(tenant.tenantId, dto, user.sub);
  }

  @Patch(':id')
  @RequirePermission('manufacturing.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateWorkCenterDto,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.workCentersService.update(id, tenant.tenantId, dto, user.sub);
  }

  // Branch System Step 5 (Owner-approved) — these two routes previously had
  // no audit trail at all (no @Audit() decorator, no manual log call).
  // Added now with real resource-branch resolution (work_centers.warehouse_id
  // is nullable, so branch_id correctly comes back null for a work center
  // with no warehouse link — never guessed, never the actor's own branch).
  @Post(':id/activate')
  @RequirePermission('manufacturing.manage')
  activate(
    @Param('id') id: string,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.workCentersService.activate(id, tenant.tenantId, user.sub);
  }

  @Post(':id/deactivate')
  @RequirePermission('manufacturing.manage')
  deactivate(
    @Param('id') id: string,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.workCentersService.deactivate(id, tenant.tenantId, user.sub);
  }
}
