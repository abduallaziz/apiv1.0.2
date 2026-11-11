import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
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
import { BranchScoped } from '../../core/security/branch-scoped.decorator';
import { EffectiveBranchId } from '../../core/security/effective-branch-id.decorator';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('tables')
export class TablesController {
  constructor(private readonly service: TablesService) {}

  // Branch Domain Batch 1, B2 (Owner-approved) — Restricted actors were
  // previously able to see every branch's tables by omitting/overriding
  // branch_id; now forced to their own branch.
  @Get()
  @RequirePermission('tables.manage')
  @BranchScoped()
  findAll(
    @GetTenant() tenant: TenantContext,
    @EffectiveBranchId() effectiveBranchId: string | null | undefined,
  ) {
    return this.service.findAll(tenant, effectiveBranchId ?? undefined);
  }

  @Get(':id')
  @RequirePermission('tables.manage')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.service.findOne(id, tenant);
  }

  // Branch Domain Batch 2, B6 (Owner-approved) — dto.branch_id was
  // previously only checked for tenant membership (any branch in the
  // tenant was accepted), not actor ownership; a restricted user's
  // request now has it overridden with the server-derived
  // effectiveBranchId, rejected outright on an explicit mismatch.
  @Post()
  @RequirePermission('tables.manage')
  @BranchScoped({ source: 'body', mode: 'write' })
  create(
    @GetTenant() tenant: TenantContext,
    @Body() dto: CreateTableDto,
    @EffectiveBranchId() effectiveBranchId: string | null | undefined,
  ) {
    if (!effectiveBranchId) {
      throw new BadRequestException('branch_id is required to create a table');
    }
    return this.service.create(tenant, {
      ...dto,
      branch_id: effectiveBranchId,
    });
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
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.service.remove(id, tenant);
  }
}
