import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';
import { ExpenseEngine } from '../../engines/expense-engine/expense.engine';
import { ApprovalEngine } from '../../engines/approval-engine/approval.engine';
import { MetricsService } from '../../core/metrics/metrics.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { RejectExpenseDto } from './dto/reject-expense.dto';
import { QueryExpensesDto } from './dto/query-expenses.dto';

@Injectable()
export class ExpensesService {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
    private readonly expenseEngine: ExpenseEngine,
    private readonly approvalEngine: ApprovalEngine,
    private readonly metricsService: MetricsService,
  ) {}

  async getStats(tenantId: string, branchId?: string) {
    let query = this.supabase
      .from('expenses')
      .select('status, amount')
      .eq('tenant_id', tenantId)
      .is('deleted_at', null);

    if (branchId) query = query.eq('branch_id', branchId);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const all = data ?? [];
    const approved = all.filter((e) => e.status === 'approved');
    const pending = all.filter((e) => e.status === 'pending');
    const rejected = all.filter((e) => e.status === 'rejected');

    const sum = (arr: typeof all) =>
      arr.reduce((s, e) => s + Number(e.amount), 0);

    return {
      total_count: all.length,
      total_amount: sum(approved),
      approved_count: approved.length,
      approved_amount: sum(approved),
      pending_count: pending.length,
      pending_amount: sum(pending),
      rejected_count: rejected.length,
      rejected_amount: sum(rejected),
    };
  }

  async findAll(tenantId: string, query: QueryExpensesDto) {
  let req = this.supabase
    .from('expenses')
    .select(`
      *,
      requester:users!requested_by(id, name, role),
      approver:users!approved_by(id, name, role)
    `)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (query.branch_id) req = req.eq('branch_id', query.branch_id);
  if (query.status) req = req.eq('status', query.status);
  if (query.from) req = req.gte('created_at', query.from);
  if (query.to) req = req.lte('created_at', query.to);

  const { data, error } = await req;
  if (error) throw new Error(error.message);
  return data;
}

  async findOne(id: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('expenses')
      .select(`
        *,
        category:expense_categories(id, name),
        requester:users!requested_by(id, name, role),
        approver:users!approved_by(id, name, role)
      `)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .single();

    if (error || !data) throw new NotFoundException('Expense not found');
    return data;
  }

  async create(dto: CreateExpenseDto, tenantId: string, userId: string) {
    const expiryHours = 8760;

    const expenseData = {
      tenant_id: tenantId,
      branch_id: dto.branch_id,
      category_id: dto.category_id,
      requested_by: userId,
      amount: dto.amount,
      title: dto.description ?? '',
      notes: dto.description ?? null,
      type: dto.type,
      recurrence: dto.recurrence ?? null,
      photo_url: dto.photo_url ?? null,
      status: 'pending',
      expires_at: new Date(Date.now() + expiryHours * 3600000).toISOString(),
    };

    const { data, error } = await this.supabase
      .from('expenses')
      .insert(expenseData)
      .select()
      .single();

    if (error) throw new Error(error.message);

    this.metricsService.recordExpense(tenantId, 'requested');

    return data;
  }

  async approve(id: string, tenantId: string, approverId: string) {
    const expense = await this.findOne(id, tenantId);

    if (!this.approvalEngine.canApprove(expense.status)) {
      throw new BadRequestException(
        `Cannot approve expense with status: ${expense.status}`,
      );
    }

    if (this.expenseEngine.isExpired(expense.expires_at)) {
      await this.supabase
        .from('expenses')
        .update({ status: 'expired' })
        .eq('id', id)
        .eq('tenant_id', tenantId);
      throw new BadRequestException('Expense has expired and cannot be approved');
    }

    const result = this.approvalEngine.approve(approverId);

    const { data, error } = await this.supabase
      .from('expenses')
      .update({
        status: result.status,
        approved_by: result.resolvedBy,
        resolved_at: result.resolvedAt,
      })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single();

    if (error) throw new Error(error.message);

    this.metricsService.recordExpense(tenantId, 'approved');

    return data;
  }

  async reject(
    id: string,
    dto: RejectExpenseDto,
    tenantId: string,
    approverId: string,
  ) {
    const expense = await this.findOne(id, tenantId);

    if (!this.approvalEngine.canReject(expense.status)) {
      throw new BadRequestException(
        `Cannot reject expense with status: ${expense.status}`,
      );
    }

    const result = this.approvalEngine.reject(approverId, dto.reason);

    const { data, error } = await this.supabase
      .from('expenses')
      .update({
        status: result.status,
        approved_by: result.resolvedBy,
        resolved_at: result.resolvedAt,
        notes: expense.notes
          ? `${expense.notes} | Rejected: ${result.reason}`
          : `Rejected: ${result.reason}`,
      })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single();

    if (error) throw new Error(error.message);

    this.metricsService.recordExpense(tenantId, 'rejected');

    return data;
  }

  async cancel(id: string, tenantId: string) {
    const expense = await this.findOne(id, tenantId);

    if (expense.status !== 'pending') {
      throw new BadRequestException(
        `Cannot cancel expense with status: ${expense.status}`,
      );
    }

    const { data, error } = await this.supabase
      .from('expenses')
      .update({
        status: 'cancelled',
        resolved_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single();

    if (error) throw new Error(error.message);

    this.metricsService.recordExpense(tenantId, 'cancelled');

    return data;
  }

  async expireStaleExpenses(): Promise<number> {
    const { data, error } = await this.supabase
      .from('expenses')
      .update({ status: 'expired' })
      .eq('status', 'pending')
      .lt('expires_at', new Date().toISOString())
      .select('id');

    if (error) {
      console.error('[ExpenseScheduler] Error expiring expenses:', error.message);
      return 0;
    }

    return data?.length ?? 0;
  }
}