import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { PosRegistersService } from './pos-registers.service';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';
import { BranchScoped } from '../../core/security/branch-scoped.decorator';
import { EffectiveBranchId } from '../../core/security/effective-branch-id.decorator';
import { CreatePosRegisterDto } from './dto/create-pos-register.dto';
import { UpdatePosRegisterDto } from './dto/update-pos-register.dto';

// Registers are a branch-management concern: reuse the branches permissions (owner/manager).
// @BranchScoped resolves the server-authoritative branch — a central owner may manage ANY branch of the
// tenant, a branch-restricted user only their own (never the raw query/body branch_id).
@Controller('pos-registers')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
export class PosRegistersController {
  constructor(private readonly service: PosRegistersService) {}

  @Get()
  @RequirePermission('branches.view')
  @BranchScoped({ source: 'query', mode: 'read' })
  list(
    @GetTenant() tenant: TenantContext,
    @EffectiveBranchId() branchId: string | null | undefined,
  ) {
    if (!branchId) throw new BadRequestException('branch_id is required');
    return this.service.listByBranch(tenant, branchId);
  }

  @Post()
  @RequirePermission('branches.manage')
  @BranchScoped({ source: 'body', mode: 'write' })
  create(
    @Body() dto: CreatePosRegisterDto,
    @GetTenant() tenant: TenantContext,
    @EffectiveBranchId() branchId: string | null | undefined,
  ) {
    if (!branchId) throw new BadRequestException('branch_id is required');
    return this.service.create(dto, tenant, branchId);
  }

  @Patch(':id')
  @RequirePermission('branches.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdatePosRegisterDto,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.service.update(id, dto, tenant);
  }

  @Delete(':id')
  @RequirePermission('branches.manage')
  remove(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.service.remove(id, tenant);
  }
}
