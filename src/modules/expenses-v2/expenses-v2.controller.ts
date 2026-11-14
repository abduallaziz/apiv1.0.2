import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant-context';
import { BranchScoped } from '../../core/security/branch-scoped.decorator';
import { EffectiveBranchId } from '../../core/security/effective-branch-id.decorator';
import { ExpensesV2Service } from './expenses-v2.service';
import { ExpenseActivityService } from './expense-activity.service';
import { ExpenseAttachmentsService } from './expense-attachments.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { CreateQuickExpenseDto } from './dto/create-quick-expense.dto';
import { CancelExpenseDto } from './dto/cancel-expense.dto';
import { FilterExpensesDto } from './dto/filter-expenses.dto';

// New Expenses domain — Expense core (Step 4 of the locked Execution
// Protocol). Route prefix `expenses-v2`, same coexistence convention as
// Department/Category administration (Step 3) — see the Owner Decision on
// the module path conflict (2026-08-16): this stays `expenses-v2` until a
// separately-approved future rename to `expenses` once Legacy is removed.
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('expenses-v2/expenses')
export class ExpensesV2Controller {
  constructor(
    private readonly service: ExpensesV2Service,
    private readonly activityService: ExpenseActivityService,
    private readonly attachmentsService: ExpenseAttachmentsService,
  ) {}

  // Branch Domain Batch 1, B2 (Owner-approved) — Restricted actors were
  // previously able to see every branch's expenses by omitting/overriding
  // branch_id; now forced to their own branch.
  @Get()
  @RequirePermission('expenses.view')
  @BranchScoped()
  async findAll(
    @GetTenant() tenant: TenantContext,
    @Query() filters: FilterExpensesDto,
    @EffectiveBranchId() effectiveBranchId?: string | null,
  ) {
    return this.service.findAll(tenant.tenantId, {
      ...filters,
      branch_id: effectiveBranchId ?? undefined,
    });
  }

  @Get(':id')
  @RequirePermission('expenses.view')
  async findOne(@GetTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.service.findOne(tenant.tenantId, id);
  }

  @Get(':id/activity')
  @RequirePermission('expenses.view')
  async findActivity(
    @GetTenant() tenant: TenantContext,
    @Param('id') id: string,
  ) {
    return this.activityService.findByExpense(tenant.tenantId, id);
  }

  @Post()
  @RequirePermission('expenses.create')
  async create(
    @GetTenant() tenant: TenantContext,
    @Body() dto: CreateExpenseDto,
    @Req() req: Request,
  ) {
    const user = req.user as { sub: string };
    return this.service.create(tenant.tenantId, tenant.branchId, user.sub, dto);
  }

  @Post('quick/:definitionId')
  @RequirePermission('expenses.create')
  async createFromQuick(
    @GetTenant() tenant: TenantContext,
    @Param('definitionId') definitionId: string,
    @Body() dto: CreateQuickExpenseDto,
    @Req() req: Request,
  ) {
    const user = req.user as { sub: string };
    return this.service.createFromQuick(
      tenant.tenantId,
      tenant.branchId,
      user.sub,
      definitionId,
      dto,
    );
  }

  @Patch(':id')
  @RequirePermission('expenses.manage')
  async update(
    @GetTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body() dto: UpdateExpenseDto,
    @Req() req: Request,
  ) {
    const user = req.user as { sub: string };
    return this.service.update(tenant.tenantId, id, dto, user.sub);
  }

  @Patch(':id/cancel')
  @RequirePermission('expenses.manage')
  async cancel(
    @GetTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body() dto: CancelExpenseDto,
    @Req() req: Request,
  ) {
    const user = req.user as { sub: string };
    return this.service.cancel(tenant.tenantId, id, user.sub, dto?.reason);
  }

  @Patch(':id/confirm-payment')
  @RequirePermission('expenses.manage')
  async confirmPayment(
    @GetTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    const user = req.user as { sub: string };
    return this.service.confirmPayment(tenant.tenantId, id, user.sub);
  }

  @Patch(':id/stop-recurring')
  @RequirePermission('expenses.manage')
  async stopRecurring(
    @GetTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    const user = req.user as { sub: string };
    return this.service.stopRecurring(tenant.tenantId, id, user.sub);
  }

  @Get(':id/attachments')
  @RequirePermission('expenses.view')
  async findAttachments(
    @GetTenant() tenant: TenantContext,
    @Param('id') id: string,
  ) {
    return this.attachmentsService.findByExpense(tenant.tenantId, id);
  }

  @Post(':id/attachments')
  @RequirePermission('expenses.manage')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  async uploadAttachment(
    @GetTenant() tenant: TenantContext,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    const user = req.user as { sub: string };
    return this.attachmentsService.upload(tenant.tenantId, id, user.sub, file);
  }
}
