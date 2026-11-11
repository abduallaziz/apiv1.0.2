import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';
import { isUniqueViolation } from '../../shared/supabase/postgrest-error.util';
import { CreateQuickDefinitionDto } from './dto/create-quick-definition.dto';
import { UpdateQuickDefinitionDto } from './dto/update-quick-definition.dto';

const SELECT =
  'id, label, amount_mode, fixed_amount, tax_mode, default_department_id, ' +
  'default_category_id, default_payment_method, sort_order, is_active, ' +
  'created_at, updated_at';

export interface QuickDefinitionRecord {
  id: string;
  label: string;
  amount_mode: 'fixed' | 'variable';
  fixed_amount: number | null;
  tax_mode: 'none' | 'inclusive' | 'exclusive';
  default_department_id: string | null;
  default_category_id: string | null;
  default_payment_method: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// Quick Expense Definitions (Step 5 of the locked Execution Protocol) —
// admin-configured buttons, exactly two `amount_mode`s (Fixed/Variable),
// enforced both here and by the DB's own
// `chk_expense_quick_definitions_amount_pairing` constraint.
@Injectable()
export class ExpenseQuickDefinitionsService {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

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

  private assertPairing(
    amountMode: 'fixed' | 'variable',
    fixedAmount: number | null | undefined,
  ) {
    if (
      amountMode === 'fixed' &&
      (fixedAmount === undefined || fixedAmount === null)
    ) {
      throw new BadRequestException(
        'fixed_amount is required when amount_mode is "fixed"',
      );
    }
    if (
      amountMode === 'variable' &&
      fixedAmount !== undefined &&
      fixedAmount !== null
    ) {
      throw new BadRequestException(
        'fixed_amount must not be set when amount_mode is "variable"',
      );
    }
  }

  async findAll(tenantId: string, includeInactive = false) {
    let query = this.supabase
      .from('expense_quick_definitions')
      .select(SELECT)
      .eq('tenant_id', tenantId)
      .order('sort_order');
    if (!includeInactive) query = query.eq('is_active', true);

    const { data, error } = await query;
    if (error) throw error;
    return data ?? [];
  }

  async findOne(tenantId: string, id: string): Promise<QuickDefinitionRecord> {
    const { data, error } = await this.supabase
      .from('expense_quick_definitions')
      .select(SELECT)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle<QuickDefinitionRecord>();
    if (error) throw error;
    if (!data)
      throw new NotFoundException('Quick Expense definition not found');
    return data;
  }

  async create(
    tenantId: string,
    createdBy: string,
    dto: CreateQuickDefinitionDto,
  ) {
    this.assertPairing(dto.amount_mode, dto.fixed_amount);

    if (dto.default_department_id) {
      await this.assertActiveMaster(
        'expense_departments',
        tenantId,
        dto.default_department_id,
        'Department',
      );
    }
    if (dto.default_category_id) {
      await this.assertActiveMaster(
        'expense_categories_v2',
        tenantId,
        dto.default_category_id,
        'Category',
      );
    }

    const { data, error } = await this.supabase
      .from('expense_quick_definitions')
      .insert({
        tenant_id: tenantId,
        label: dto.label,
        amount_mode: dto.amount_mode,
        fixed_amount: dto.amount_mode === 'fixed' ? dto.fixed_amount : null,
        tax_mode: dto.tax_mode,
        default_department_id: dto.default_department_id ?? null,
        default_category_id: dto.default_category_id ?? null,
        default_payment_method: dto.default_payment_method,
        sort_order: dto.sort_order ?? 0,
        created_by: createdBy,
      })
      .select(SELECT)
      .single();

    if (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          'A Quick Expense definition with this label already exists',
        );
      }
      throw error;
    }
    return data;
  }

  async update(tenantId: string, id: string, dto: UpdateQuickDefinitionDto) {
    const existing = await this.findOne(tenantId, id);

    const amountMode = dto.amount_mode ?? existing.amount_mode;
    const fixedAmount =
      dto.fixed_amount !== undefined ? dto.fixed_amount : existing.fixed_amount;
    if (dto.amount_mode !== undefined || dto.fixed_amount !== undefined) {
      this.assertPairing(amountMode, fixedAmount);
    }

    if (dto.default_department_id) {
      await this.assertActiveMaster(
        'expense_departments',
        tenantId,
        dto.default_department_id,
        'Department',
      );
    }
    if (dto.default_category_id) {
      await this.assertActiveMaster(
        'expense_categories_v2',
        tenantId,
        dto.default_category_id,
        'Category',
      );
    }

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (dto.label !== undefined) patch.label = dto.label;
    if (dto.tax_mode !== undefined) patch.tax_mode = dto.tax_mode;
    if (dto.amount_mode !== undefined) {
      patch.amount_mode = amountMode;
      patch.fixed_amount = amountMode === 'fixed' ? fixedAmount : null;
    } else if (dto.fixed_amount !== undefined) {
      patch.fixed_amount = amountMode === 'fixed' ? fixedAmount : null;
    }
    if (dto.default_department_id !== undefined)
      patch.default_department_id = dto.default_department_id;
    if (dto.default_category_id !== undefined)
      patch.default_category_id = dto.default_category_id;
    if (dto.default_payment_method !== undefined)
      patch.default_payment_method = dto.default_payment_method;
    if (dto.sort_order !== undefined) patch.sort_order = dto.sort_order;
    if (dto.is_active !== undefined) patch.is_active = dto.is_active;

    const { data, error } = await this.supabase
      .from('expense_quick_definitions')
      .update(patch)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select(SELECT)
      .maybeSingle();

    if (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          'A Quick Expense definition with this label already exists',
        );
      }
      throw error;
    }
    if (!data)
      throw new NotFoundException('Quick Expense definition not found');
    return data;
  }

  // DELETE is unconditionally blocked at the DB level (guard trigger,
  // 197_new_expenses_database_foundation.sql) — deactivation is the only
  // removal path, matching Department/Category.
  async deactivate(tenantId: string, id: string) {
    return this.update(tenantId, id, { is_active: false });
  }
}
