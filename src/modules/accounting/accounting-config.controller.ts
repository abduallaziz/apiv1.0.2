import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant-context';
import { AccountingService } from './accounting.service';
import { AssignBranchAccountingOwnerDto } from './dto/assign-branch-accounting-owner.dto';

// Accounting Backend Phase 1 — Accounting Owners / Branch Assignments.
// The one write endpoint in this module (assign a branch to an owner) —
// reuses the exact same guarded INSERT AccountingBootstrapService already
// performs (fn_guard_branch_accounting_assignment_mutation, unchanged).
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('accounting')
export class AccountingConfigController {
  constructor(private readonly accountingService: AccountingService) {}

  @Get('owners')
  @RequirePermission('accounting.configuration.manage')
  async owners(@GetTenant() tenant: TenantContext) {
    return this.accountingService.listAccountingOwners(tenant);
  }

  @Get('branch-assignments')
  @RequirePermission('accounting.configuration.manage')
  async branchAssignments(@GetTenant() tenant: TenantContext) {
    return this.accountingService.listBranchAssignments(tenant);
  }

  @Post('branch-assignments')
  @RequirePermission('accounting.configuration.manage')
  async assignBranch(
    @Body() dto: AssignBranchAccountingOwnerDto,
    @GetTenant() tenant: TenantContext,
    @Req() req: Request,
  ) {
    const user = req.user as { sub: string };
    return this.accountingService.assignBranchAccountingOwner(
      tenant,
      dto,
      user.sub,
    );
  }
}
