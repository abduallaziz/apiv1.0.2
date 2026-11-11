import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  ParseUUIDPipe,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { WaitlistService } from './waitlist.service';
import { CreateWaitlistEntryDto } from './dto/create-waitlist-entry.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant-context';
import { BranchScoped } from '../../core/security/branch-scoped.decorator';
import { EffectiveBranchId } from '../../core/security/effective-branch-id.decorator';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('waitlist')
export class WaitlistController {
  constructor(private readonly service: WaitlistService) {}

  // Branch Domain Batch 1, B2 (Owner-approved) — Restricted actors were
  // previously able to see every branch's waitlist by omitting/overriding
  // branch_id; now forced to their own branch.
  @Get()
  @RequirePermission('tables.manage')
  @BranchScoped()
  findAll(
    @GetTenant() tenant: TenantContext,
    @EffectiveBranchId() effectiveBranchId: string | null | undefined,
    @Query('status') status?: string,
  ) {
    return this.service.findAll(tenant, effectiveBranchId ?? undefined, status);
  }

  // Branch Domain Batch 2, B6 (Owner-approved) — dto.branch_id was
  // previously only checked for tenant membership, not actor ownership; a
  // restricted user's request now has it overridden with the
  // server-derived effectiveBranchId, rejected outright on an explicit
  // mismatch.
  @Post()
  @RequirePermission('tables.manage')
  @BranchScoped({ source: 'body', mode: 'write' })
  create(
    @GetTenant() tenant: TenantContext,
    @Body() dto: CreateWaitlistEntryDto,
    @EffectiveBranchId() effectiveBranchId: string | null | undefined,
  ) {
    if (!effectiveBranchId) {
      throw new BadRequestException(
        'branch_id is required to create a waitlist entry',
      );
    }
    return this.service.create(tenant, {
      ...dto,
      branch_id: effectiveBranchId,
    });
  }

  @Patch(':id/seat')
  @RequirePermission('tables.manage')
  seat(
    @Param('id', ParseUUIDPipe) id: string,
    @GetTenant() tenant: TenantContext,
    @Body('table_id') tableId: string,
    @Req() req: Request,
  ) {
    const user = req.user as { sub: string };
    return this.service.seat(tenant, id, tableId, user.sub);
  }

  @Patch(':id/cancel')
  @RequirePermission('tables.manage')
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.service.cancel(tenant, id);
  }
}
