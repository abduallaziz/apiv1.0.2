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
  Request,
} from '@nestjs/common';
import { PaginationDto } from '../../shared/dto/pagination.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { Audit } from '../../core/audit/audit.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';
import { BranchScoped } from '../../core/security/branch-scoped.decorator';
import { EffectiveBranchId } from '../../core/security/effective-branch-id.decorator';
import { ExpensesService } from './expenses.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { RejectExpenseDto } from './dto/reject-expense.dto';
import { QueryExpensesDto } from './dto/query-expenses.dto';

@Controller('expenses')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  // Branch Domain Batch 1, B2 (Owner-approved) — Restricted actors were
  // previously able to see every branch's expense stats/list by omitting
  // or overriding branch_id; now forced to their own branch.
  @Get('stats')
  @RequirePermission('expenses.view')
  @BranchScoped()
  getStats(
    @GetTenant() tenant: TenantContext,
    @Request() req: any,
    @EffectiveBranchId() effectiveBranchId: string | null | undefined,
  ) {
    const tenantId = tenant?.tenantId ?? req.user.tenant_id;
    return this.expensesService.getStats(
      tenantId,
      effectiveBranchId ?? undefined,
    );
  }

  @Get()
  @RequirePermission('expenses.view')
  @BranchScoped()
  findAll(
    @GetTenant() tenant: TenantContext,
    @Query() query: QueryExpensesDto,
    @Query('page') page?: string,
    @Query('per_page') perPage?: string,
    @EffectiveBranchId() effectiveBranchId?: string | null,
    @Request() req?: any,
  ) {
    const tenantId = tenant?.tenantId ?? req.user.tenant_id;
    return this.expensesService.findAll(
      tenantId,
      { ...query, branch_id: effectiveBranchId ?? undefined },
      new PaginationDto(page, perPage),
    );
  }

  @Get(':id')
  @RequirePermission('expenses.view')
  findOne(
    @Param('id') id: string,
    @GetTenant() tenant: TenantContext,
    @Request() req: any,
  ) {
    const tenantId = tenant?.tenantId ?? req.user.tenant_id;
    return this.expensesService.findOne(id, tenantId);
  }

  // Branch Domain Batch 2, B6 (Owner-approved) — dto.branch_id was
  // previously trusted outright; a restricted user's request now has it
  // overridden with the server-derived effectiveBranchId, rejected
  // outright on an explicit mismatch.
  @Post()
  @Audit('expense.request')
  @RequirePermission('expense.request')
  @BranchScoped({ source: 'body', mode: 'write' })
  create(
    @Body() dto: CreateExpenseDto,
    @GetTenant() tenant: TenantContext,
    @EffectiveBranchId() effectiveBranchId: string | null | undefined,
    @Request() req: any,
  ) {
    if (!effectiveBranchId) {
      throw new BadRequestException(
        'branch_id is required to submit an expense',
      );
    }
    const tenantId = tenant?.tenantId ?? req.user.tenant_id;
    return this.expensesService.create(
      { ...dto, branch_id: effectiveBranchId },
      tenantId,
      req.user.sub,
    );
  }

  @Patch(':id/approve')
  @Audit('expense.approve')
  @RequirePermission('expense.approve')
  approve(
    @Param('id') id: string,
    @GetTenant() tenant: TenantContext,
    @Request() req: any,
  ) {
    const tenantId = tenant?.tenantId ?? req.user.tenant_id;
    return this.expensesService.approve(id, tenantId, req.user.sub);
  }

  @Patch(':id/reject')
  @Audit('expense.reject')
  @RequirePermission('expense.reject')
  reject(
    @Param('id') id: string,
    @Body() dto: RejectExpenseDto,
    @GetTenant() tenant: TenantContext,
    @Request() req: any,
  ) {
    const tenantId = tenant?.tenantId ?? req.user.tenant_id;
    return this.expensesService.reject(id, dto, tenantId, req.user.sub);
  }

  @Patch(':id/cancel')
  @Audit('expense.cancel')
  @RequirePermission('expense.request')
  cancel(
    @Param('id') id: string,
    @GetTenant() tenant: TenantContext,
    @Request() req: any,
  ) {
    const tenantId = tenant?.tenantId ?? req.user.tenant_id;
    return this.expensesService.cancel(id, tenantId);
  }
}
