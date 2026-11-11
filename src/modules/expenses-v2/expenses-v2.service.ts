import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { CreateQuickExpenseDto } from './dto/create-quick-expense.dto';
import { FilterExpensesDto } from './dto/filter-expenses.dto';
import { ExpenseActivityService } from './expense-activity.service';

const SELECT =
  'id, branch_id, department_id, category_id, title, description, amount, ' +
  'tax_mode, tax_amount, total_amount, payment_method, payment_status, ' +
  'approval_status, reference_number, source, created_by, cancelled_by, ' +
  'cancelled_at, is_recurring, frequency, next_occurrence_date, ' +
  'recurring_end_date, recurring_source_expense_id, expense_date, ' +
  'shift_id, created_at, updated_at';

interface TaxBreakdown {
  amount: number;
  tax_amount: number;
  total_amount: number;
}

export interface ExpenseRecord {
  id: string;
  branch_id: string;
  department_id: string;
  category_id: string;
  title: string;
  description: string | null;
  amount: number;
  tax_mode: 'none' | 'inclusive' | 'exclusive';
  tax_amount: number;
  total_amount: number;
  payment_method: string;
  payment_status: 'paid' | 'unpaid';
  approval_status: string;
  reference_number: string | null;
  source: string;
  created_by: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  is_recurring: boolean;
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly' | null;
  next_occurrence_date: string | null;
  recurring_end_date: string | null;
  recurring_source_expense_id: string | null;
  expense_date: string;
  shift_id: string | null;
  created_at: string;
  updated_at: string;
}

// Expense Core (Step 4 of the locked Execution Protocol). Branch is always
// derived from the request's tenant/branch context (`TenantContext.branchId`,
// sourced from the `x-branch-id` header + TenantGuard validation) — the
// client-supplied DTO never carries `branch_id`, satisfying the locked
// "Branch cannot be client-overridden" rule.
@Injectable()
export class ExpensesV2Service {
  private readonly logger = new Logger(ExpensesV2Service.name);

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
    private readonly activityService: ExpenseActivityService,
  ) {}

  private async getTenantTaxRate(tenantId: string): Promise<number> {
    const { data, error } = await this.supabase
      .from('tenants')
      .select('tax_rate')
      .eq('id', tenantId)
      .single<{ tax_rate: number | null }>();
    if (error || !data) return 0;
    return data.tax_rate ?? 0;
  }

  // Normalizes user entry into canonical stored values, matching the locked
  // three-value tax model — none/inclusive/exclusive — now shared
  // identically by expenses_v2.tax_mode and
  // expense_quick_definitions.tax_mode (Step 5 final tax model correction,
  // migration 199): none = no tax at all; exclusive entry = pre-tax amount
  // typed directly, tax added on top; inclusive entry = total typed,
  // amount/tax derived by dividing out the tenant's flat tax_rate.
  // `amount` always ends up storing the pre-tax figure.
  private computeTax(
    enteredAmount: number,
    taxMode: 'none' | 'inclusive' | 'exclusive',
    taxRate: number,
  ): TaxBreakdown {
    if (taxMode === 'none') {
      return {
        amount: enteredAmount,
        tax_amount: 0,
        total_amount: enteredAmount,
      };
    }
    if (taxMode === 'exclusive') {
      const tax = parseFloat((enteredAmount * taxRate).toFixed(2));
      return {
        amount: enteredAmount,
        tax_amount: tax,
        total_amount: parseFloat((enteredAmount + tax).toFixed(2)),
      };
    }
    const amount = parseFloat((enteredAmount / (1 + taxRate)).toFixed(2));
    const tax = parseFloat((enteredAmount - amount).toFixed(2));
    return { amount, tax_amount: tax, total_amount: enteredAmount };
  }

  private async assertActiveMaster(
    table: 'expense_departments' | 'expense_categories_v2',
    tenantId: string,
    id: string,
    label: string,
  ) {
    const { data, error } = await this.supabase
      .from(table)
      .select('id, is_active')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new BadRequestException(`${label} not found`);
    if (!data.is_active) {
      throw new BadRequestException(
        `${label} is deactivated and cannot be used`,
      );
    }
  }

  async findAll(tenantId: string, filters: FilterExpensesDto = {}) {
    let query = this.supabase
      .from('expenses_v2')
      .select(SELECT)
      .eq('tenant_id', tenantId);

    if (filters.branch_id) query = query.eq('branch_id', filters.branch_id);
    if (filters.department_id)
      query = query.eq('department_id', filters.department_id);
    if (filters.category_id)
      query = query.eq('category_id', filters.category_id);
    if (filters.source) query = query.eq('source', filters.source);
    if (filters.payment_status)
      query = query.eq('payment_status', filters.payment_status);
    if (filters.search) query = query.ilike('title', `%${filters.search}%`);
    if (filters.date_from) query = query.gte('expense_date', filters.date_from);
    if (filters.date_to) query = query.lte('expense_date', filters.date_to);
    if (filters.amount_min !== undefined)
      query = query.gte('amount', filters.amount_min);
    if (filters.amount_max !== undefined)
      query = query.lte('amount', filters.amount_max);
    if (filters.exclude_cancelled === 'true')
      query = query.is('cancelled_at', null);
    if (filters.is_recurring !== undefined)
      query = query.eq('is_recurring', filters.is_recurring === 'true');

    const { data, error } = await query.order('expense_date', {
      ascending: false,
    });
    if (error) throw error;
    return data ?? [];
  }

  async findOne(tenantId: string, id: string): Promise<ExpenseRecord> {
    const { data, error } = await this.supabase
      .from('expenses_v2')
      .select(SELECT)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle<ExpenseRecord>();
    if (error) throw error;
    if (!data) throw new NotFoundException('Expense not found');
    return data;
  }

  async create(
    tenantId: string,
    branchId: string | null,
    createdBy: string,
    dto: CreateExpenseDto,
  ) {
    // Branch is mandatory on every Expense and is never client-supplied —
    // if the request context has no resolved branch, creation is blocked
    // rather than falling back to any default/"Unassigned" value.
    if (!branchId) {
      throw new BadRequestException(
        'No branch context resolved for this request — Branch is required and cannot be omitted',
      );
    }

    await this.assertActiveMaster(
      'expense_departments',
      tenantId,
      dto.department_id,
      'Department',
    );
    await this.assertActiveMaster(
      'expense_categories_v2',
      tenantId,
      dto.category_id,
      'Category',
    );

    const shiftId = await this.resolveRegisterForCashExpense(
      tenantId,
      branchId,
      dto,
    );

    const taxRate = await this.getTenantTaxRate(tenantId);
    const { amount, tax_amount, total_amount } = this.computeTax(
      dto.amount,
      dto.tax_mode,
      taxRate,
    );

    // Recurring Expenses Final Implementation (Owner Decision): the Expense
    // IS the recurring source — no Template. next_occurrence_date is never
    // client-supplied; it's the first auto-generated occurrence, due one
    // full period after today (today's own creation already covers the
    // "first occurrence" — the cron job only ever creates occurrence #2+).
    const isRecurring = dto.is_recurring === true;
    const today = new Date().toISOString().slice(0, 10);

    return this.insertExpense(tenantId, {
      branch_id: branchId,
      department_id: dto.department_id,
      category_id: dto.category_id,
      title: dto.title,
      description: dto.description ?? null,
      amount,
      tax_mode: dto.tax_mode,
      tax_amount,
      total_amount,
      payment_method: dto.payment_method,
      reference_number: dto.reference_number ?? null,
      source: 'manual',
      created_by: createdBy,
      payment_status: dto.payment_status,
      shift_id: shiftId,
      expense_date: dto.expense_date ?? today,
      is_recurring: isRecurring,
      frequency: isRecurring ? dto.frequency : undefined,
      next_occurrence_date: isRecurring
        ? this.advanceDate(today, dto.frequency)
        : undefined,
      recurring_end_date: isRecurring ? dto.recurring_end_date : undefined,
    });
  }

  // Manual Quick Expense (Step 5, tax mode correction) — creates an Expense
  // from an admin-configured Quick Definition. Fixed mode: amount is
  // entirely predetermined, no amount input accepted at all. Variable
  // mode: amount is the ONLY field the caller supplies. Department/Category
  // default from the definition but may be overridden in this Manual
  // context (the future POS trigger, not built here, never allows any
  // override). Payment Method and Tax Mode always come from the
  // definition — Tax Mode is Admin-configured only, `CreateQuickExpenseDto`
  // has no such field so a client can never supply/override it.
  async createFromQuick(
    tenantId: string,
    branchId: string | null,
    createdBy: string,
    definitionId: string,
    dto: CreateQuickExpenseDto,
  ) {
    if (!branchId) {
      throw new BadRequestException(
        'No branch context resolved for this request — Branch is required and cannot be omitted',
      );
    }

    const { data: definition, error: defError } = await this.supabase
      .from('expense_quick_definitions')
      .select(
        'id, label, amount_mode, fixed_amount, tax_mode, default_department_id, default_category_id, default_payment_method, is_active',
      )
      .eq('id', definitionId)
      .eq('tenant_id', tenantId)
      .maybeSingle<{
        id: string;
        label: string;
        amount_mode: 'fixed' | 'variable';
        fixed_amount: number | null;
        tax_mode: 'none' | 'inclusive' | 'exclusive';
        default_department_id: string | null;
        default_category_id: string | null;
        default_payment_method: string;
        is_active: boolean;
      }>();
    if (defError) throw defError;
    if (!definition)
      throw new NotFoundException('Quick Expense definition not found');
    if (!definition.is_active) {
      throw new BadRequestException('Quick Expense definition is deactivated');
    }

    let enteredAmount: number;
    if (definition.amount_mode === 'fixed') {
      if (dto.amount !== undefined) {
        throw new BadRequestException(
          'Amount cannot be provided for a Fixed-mode Quick Expense — it is predetermined by the definition',
        );
      }
      enteredAmount = definition.fixed_amount!;
    } else {
      if (dto.amount === undefined) {
        throw new BadRequestException(
          'Amount is required for a Variable-mode Quick Expense',
        );
      }
      enteredAmount = dto.amount;
    }

    const departmentId = dto.department_id ?? definition.default_department_id;
    const categoryId = dto.category_id ?? definition.default_category_id;
    if (!departmentId) {
      throw new BadRequestException(
        'This Quick Expense definition has no default Department — one must be provided',
      );
    }
    if (!categoryId) {
      throw new BadRequestException(
        'This Quick Expense definition has no default Category — one must be provided',
      );
    }

    await this.assertActiveMaster(
      'expense_departments',
      tenantId,
      departmentId,
      'Department',
    );
    await this.assertActiveMaster(
      'expense_categories_v2',
      tenantId,
      categoryId,
      'Category',
    );

    const taxRate = await this.getTenantTaxRate(tenantId);
    const { amount, tax_amount, total_amount } = this.computeTax(
      enteredAmount,
      definition.tax_mode,
      taxRate,
    );

    return this.insertExpense(tenantId, {
      branch_id: branchId,
      department_id: departmentId,
      category_id: categoryId,
      title: definition.label,
      description: null,
      amount,
      tax_mode: definition.tax_mode,
      tax_amount,
      total_amount,
      payment_method: definition.default_payment_method,
      reference_number: null,
      source: 'quick',
      created_by: createdBy,
      expense_date: new Date().toISOString().slice(0, 10),
    });
  }

  // Phase 5 / T8: validates the optional register link of a CASH expense.
  // It must be a PAID cash expense, the register must belong to this tenant,
  // be OPEN and be in the expense's own branch (the money left THAT drawer).
  private async resolveRegisterForCashExpense(
    tenantId: string,
    branchId: string,
    dto: { shift_id?: string; payment_method: string; payment_status?: 'paid' | 'unpaid' },
  ): Promise<string | null> {
    if (!dto.shift_id) return null;
    if (dto.payment_method.trim().toLowerCase() !== 'cash') {
      throw new BadRequestException(
        'A register can only be linked to a cash expense',
      );
    }
    if ((dto.payment_status ?? 'paid') !== 'paid') {
      throw new BadRequestException(
        'A register can only be linked to a paid expense (the cash must have left the drawer)',
      );
    }
    const { data: shift, error } = await this.supabase
      .from('shifts')
      .select('id, status, branch_id')
      .eq('id', dto.shift_id)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw error;
    if (!shift) throw new BadRequestException('Register not found');
    if (shift.status !== 'open') {
      throw new BadRequestException(
        'The register is not open: a cash expense can only be taken from an open register',
      );
    }
    if (shift.branch_id !== branchId) {
      throw new BadRequestException(
        'The register belongs to another branch than this expense',
      );
    }
    return shift.id;
  }

  private async insertExpense(
    tenantId: string,
    row: {
      branch_id: string;
      department_id: string;
      category_id: string;
      title: string;
      description: string | null;
      amount: number;
      tax_mode: 'none' | 'inclusive' | 'exclusive';
      tax_amount: number;
      total_amount: number;
      payment_method: string;
      reference_number: string | null;
      source: string;
      created_by: string | null;
      expense_date: string;
      payment_status?: 'paid' | 'unpaid';
      is_recurring?: boolean;
      frequency?: 'daily' | 'weekly' | 'monthly' | 'yearly';
      next_occurrence_date?: string;
      recurring_end_date?: string;
      recurring_source_expense_id?: string;
      shift_id?: string | null;
    },
  ) {
    const { data, error } = await this.supabase
      .from('expenses_v2')
      .insert({ tenant_id: tenantId, ...row })
      .select(SELECT)
      .single<ExpenseRecord>();

    if (error) throw error;

    // Every creation path (manual, Quick, Recurring generation) funnels
    // through this single insert point, so logging 'created' here
    // guarantees completeness without needing a separate hook per caller.
    await this.activityService.log(
      tenantId,
      data.id,
      row.created_by,
      'created',
      `source: ${row.source}`,
    );

    return data;
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateExpenseDto,
    updatedBy: string,
  ) {
    const existing = await this.findOne(tenantId, id);
    if (existing.cancelled_at) {
      throw new ConflictException('Cancelled expenses cannot be edited');
    }

    if (dto.department_id) {
      await this.assertActiveMaster(
        'expense_departments',
        tenantId,
        dto.department_id,
        'Department',
      );
    }
    if (dto.category_id) {
      await this.assertActiveMaster(
        'expense_categories_v2',
        tenantId,
        dto.category_id,
        'Category',
      );
    }
    if (
      (dto.frequency !== undefined || dto.recurring_end_date !== undefined) &&
      !existing.is_recurring
    ) {
      throw new BadRequestException(
        'This Expense is not recurring — enable recurring at creation time or use a recurring Expense',
      );
    }

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (dto.department_id) patch.department_id = dto.department_id;
    if (dto.category_id) patch.category_id = dto.category_id;
    if (dto.title !== undefined) patch.title = dto.title;
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.payment_method !== undefined)
      patch.payment_method = dto.payment_method;
    if (dto.reference_number !== undefined)
      patch.reference_number = dto.reference_number;
    if (dto.expense_date !== undefined) patch.expense_date = dto.expense_date;
    if (dto.frequency !== undefined) patch.frequency = dto.frequency;
    if (dto.recurring_end_date !== undefined)
      patch.recurring_end_date = dto.recurring_end_date;

    // Amount/tax_mode are recomputed together whenever either changes, so
    // the stored amount/tax_amount/total_amount triple never drifts out of
    // sync with the tenant's tax rate.
    if (dto.amount !== undefined || dto.tax_mode !== undefined) {
      const taxRate = await this.getTenantTaxRate(tenantId);
      const enteredAmount = dto.amount ?? existing.amount;
      const taxMode = dto.tax_mode ?? existing.tax_mode;
      const { amount, tax_amount, total_amount } = this.computeTax(
        enteredAmount,
        taxMode,
        taxRate,
      );
      patch.amount = amount;
      patch.tax_mode = taxMode;
      patch.tax_amount = tax_amount;
      patch.total_amount = total_amount;
    }

    const { data, error } = await this.supabase
      .from('expenses_v2')
      .update(patch)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select(SELECT)
      .maybeSingle<ExpenseRecord>();

    if (error) throw error;
    if (!data) throw new NotFoundException('Expense not found');

    await this.activityService.log(tenantId, id, updatedBy, 'edited');
    if (dto.department_id && dto.department_id !== existing.department_id) {
      await this.activityService.log(
        tenantId,
        id,
        updatedBy,
        'department_changed',
        `${existing.department_id} -> ${dto.department_id}`,
      );
    }

    return data;
  }

  async cancel(tenantId: string, id: string, cancelledBy: string) {
    const existing = await this.findOne(tenantId, id);
    if (existing.cancelled_at) {
      throw new ConflictException('Expense is already cancelled');
    }

    const { data, error } = await this.supabase
      .from('expenses_v2')
      .update({
        cancelled_by: cancelledBy,
        cancelled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select(SELECT)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new NotFoundException('Expense not found');
    await this.activityService.log(tenantId, id, cancelledBy, 'cancelled');
    return data;
  }

  // Step 7 — the single `Confirm Payment` action: the only path that can
  // ever transition payment_status 'unpaid' -> 'paid'. Genuinely
  // idempotent (unlike cancel()) — confirming an already-paid Expense is a
  // successful no-op, not a Conflict, since "confirm" describes a target
  // state rather than a one-shot event. Cancelled Expenses can't have
  // their payment confirmed (nothing left to pay for).
  async confirmPayment(
    tenantId: string,
    id: string,
    confirmedBy: string,
  ): Promise<ExpenseRecord> {
    const existing = await this.findOne(tenantId, id);
    if (existing.cancelled_at) {
      throw new ConflictException(
        'Cancelled expenses cannot have payment confirmed',
      );
    }
    if (existing.payment_status === 'paid') {
      return existing;
    }

    const { data, error } = await this.supabase
      .from('expenses_v2')
      .update({
        payment_status: 'paid',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select(SELECT)
      .maybeSingle<ExpenseRecord>();

    if (error) throw error;
    if (!data) throw new NotFoundException('Expense not found');
    await this.activityService.log(
      tenantId,
      id,
      confirmedBy,
      'payment_confirmed',
    );
    return data;
  }

  // Recurring Expenses Final Implementation — the single dedicated action
  // that can turn recurrence off, mirroring the confirm-payment/cancel
  // pattern: never done via the generic edit endpoint. Stopping recurrence
  // does NOT cancel the Expense and does NOT touch payment_status — the
  // Expense record itself, and its history, are otherwise untouched.
  // Idempotent: already-non-recurring is a no-op, not an error.
  async stopRecurring(
    tenantId: string,
    id: string,
    actorId: string,
  ): Promise<ExpenseRecord> {
    const existing = await this.findOne(tenantId, id);
    if (!existing.is_recurring) {
      return existing;
    }

    const { data, error } = await this.supabase
      .from('expenses_v2')
      .update({ is_recurring: false, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select(SELECT)
      .maybeSingle<ExpenseRecord>();

    if (error) throw error;
    if (!data) throw new NotFoundException('Expense not found');
    await this.activityService.log(
      tenantId,
      id,
      actorId,
      'edited',
      'recurring_stopped',
    );
    return data;
  }

  // Advances a 'YYYY-MM-DD' date string by one occurrence of the given
  // frequency. Monthly/yearly clamp to the target month's last day (e.g.
  // Jan 31 + monthly -> Feb 28/29), never overflowing into the month after.
  private advanceDate(
    dateStr: string,
    frequency: 'daily' | 'weekly' | 'monthly' | 'yearly',
  ): string {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));

    if (frequency === 'daily') {
      date.setUTCDate(date.getUTCDate() + 1);
    } else if (frequency === 'weekly') {
      date.setUTCDate(date.getUTCDate() + 7);
    } else if (frequency === 'monthly') {
      const day = date.getUTCDate();
      date.setUTCDate(1);
      date.setUTCMonth(date.getUTCMonth() + 1);
      const lastDayOfMonth = new Date(
        Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
      ).getUTCDate();
      date.setUTCDate(Math.min(day, lastDayOfMonth));
    } else {
      date.setUTCFullYear(date.getUTCFullYear() + 1);
    }

    return date.toISOString().slice(0, 10);
  }

  // Recurring generation job — Recurring Expenses Final Implementation
  // (Owner Decision, supersedes the Step 6 Template-based version). Scans
  // `expenses_v2` itself (WHERE is_recurring = true AND due), never
  // `expense_recurring_templates` (dead table, no code references it after
  // this change). Runs across ALL tenants (system job, service-role
  // client, matching every other cross-tenant scheduler in this codebase).
  // Each generated occurrence is a fresh, ordinary, non-recurring Expense
  // (`is_recurring: false`) copying Department/Category/Branch/amount/
  // tax_mode/payment_method from its source, linked back only via
  // `recurring_source_expense_id` for traceability — never for behavior,
  // matching the already-locked "each generated Expense remains
  // independent" rule. Per-source failures are caught and logged so one
  // bad row can't block the rest of the batch.
  async generateDueRecurringExpenses(): Promise<{
    created: number;
    failed: number;
  }> {
    const today = new Date().toISOString().slice(0, 10);

    const { data: dueExpenses, error } = await this.supabase
      .from('expenses_v2')
      .select(
        'id, tenant_id, branch_id, department_id, category_id, title, amount, tax_mode, payment_method, frequency, recurring_end_date, next_occurrence_date, created_by',
      )
      .eq('is_recurring', true)
      .is('cancelled_at', null)
      .lte('next_occurrence_date', today);

    if (error) throw error;
    if (!dueExpenses || dueExpenses.length === 0)
      return { created: 0, failed: 0 };

    let created = 0;
    let failed = 0;

    for (const source of dueExpenses as Array<{
      id: string;
      tenant_id: string;
      branch_id: string;
      department_id: string;
      category_id: string;
      title: string;
      amount: number;
      tax_mode: 'none' | 'inclusive' | 'exclusive';
      payment_method: string;
      frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
      recurring_end_date: string | null;
      next_occurrence_date: string;
      created_by: string | null;
    }>) {
      try {
        const taxRate = await this.getTenantTaxRate(source.tenant_id);
        const { amount, tax_amount, total_amount } = this.computeTax(
          source.amount,
          source.tax_mode,
          taxRate,
        );

        await this.insertExpense(source.tenant_id, {
          branch_id: source.branch_id,
          department_id: source.department_id,
          category_id: source.category_id,
          title: source.title,
          description: null,
          amount,
          tax_mode: source.tax_mode,
          tax_amount,
          total_amount,
          payment_method: source.payment_method,
          reference_number: null,
          source: 'recurring',
          created_by: source.created_by,
          recurring_source_expense_id: source.id,
          // The occurrence's Expense Date is the date it was actually due
          // (the source's scheduled next_occurrence_date), not "today" —
          // these can differ if a cron run is delayed/missed.
          expense_date: source.next_occurrence_date,
        });
        created++;

        const nextOccurrence = this.advanceDate(
          source.next_occurrence_date,
          source.frequency,
        );
        const pastEnd =
          source.recurring_end_date !== null &&
          nextOccurrence > source.recurring_end_date;

        await this.supabase
          .from('expenses_v2')
          .update({
            next_occurrence_date: nextOccurrence,
            is_recurring: !pastEnd,
            updated_at: new Date().toISOString(),
          })
          .eq('id', source.id);
      } catch (err) {
        failed++;
        this.logger.error(
          `Failed to generate recurring Expense from source ${source.id}: ${(err as Error).message}`,
        );
      }
    }

    return { created, failed };
  }
}
