import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Put,
  Param,
  Body,
  Query,
  UseGuards,
  ParseUUIDPipe,
  Req,
} from '@nestjs/common';
import { BranchesService } from './branches.service';
import { BranchPublishService } from './publish/branch-publish.service';
import { PublishToBranchesDto } from './dto/publish-branches.dto';
import { JwtPayload } from '../../shared/types/jwt-payload.type';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant-context';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('branches')
export class BranchesController {
  constructor(
    private readonly service: BranchesService,
    private readonly publishService: BranchPublishService,
  ) {}

  // `active_only=true` is for branch-assignment selectors (Employee Wizard,
  // Employee Detail, Create User) — they must only offer branches that can
  // actually be assigned. Branch Management's own list omits it on purpose,
  // since administering branches requires seeing inactive ones too.
  @Get()
  @RequirePermission('branches.view')
  findAll(
    @GetTenant() tenant: TenantContext,
    @Query('active_only') activeOnly?: string,
  ) {
    return this.service.findAll(tenant, activeOnly === 'true');
  }

  // Branch isolation (docs/DESIGN_BRANCH_ISOLATION.md). Declared before ':id' routes.
  @Get('isolation/status')
  @RequirePermission('branches.view')
  isolation(@GetTenant() tenant: TenantContext) {
    return this.service.getIsolation(tenant);
  }

  @Put('isolation/status')
  @RequirePermission('branches.manage')
  setIsolation(
    @Body() body: { enabled: boolean },
    @GetTenant() tenant: TenantContext,
  ) {
    return this.service.setIsolation(tenant, body?.enabled === true);
  }

  @Patch(':id/main')
  @RequirePermission('branches.manage')
  setMain(
    @Param('id', ParseUUIDPipe) id: string,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.service.setMain(id, tenant);
  }

  // Publish to branches (design D8). Static routes: declared before ':id'.
  @Get('publish/types')
  @RequirePermission('branches.publish')
  publishTypes() {
    return this.publishService.listTypes();
  }

  @Post('publish')
  @RequirePermission('branches.publish')
  publish(
    @Body() dto: PublishToBranchesDto,
    @GetTenant() tenant: TenantContext,
    @Req() req: { user: JwtPayload },
  ) {
    return this.publishService.publish(tenant, dto, {
      userId: req.user?.sub ?? null,
      // A user bound to a branch is never central, whatever their role says.
      central: !req.user?.branch_id,
    });
  }

  @Get(':id')
  @RequirePermission('branches.view')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.service.findById(id, tenant);
  }

  @Post()
  @RequirePermission('branches.manage')
  create(
    @Body() dto: CreateBranchDto,
    @GetTenant() tenant: TenantContext,
    @Req() req: { user: JwtPayload },
  ) {
    return this.service.create(dto, tenant, req.user?.sub ?? null);
  }

  @Patch(':id')
  @RequirePermission('branches.manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBranchDto,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.service.update(id, dto, tenant);
  }

  @Delete(':id')
  @RequirePermission('branches.manage')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.service.remove(id, tenant);
  }
}
