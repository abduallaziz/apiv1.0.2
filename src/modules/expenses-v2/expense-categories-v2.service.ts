import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';
import { isUniqueViolation } from '../../shared/supabase/postgrest-error.util';
import { CreateExpenseCategoryDto } from './dto/create-category.dto';
import { UpdateExpenseCategoryDto } from './dto/update-category.dto';

const SELECT = 'id, name, code, description, is_active, created_at, updated_at';

@Injectable()
export class ExpenseCategoriesV2Service {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async findAll(tenantId: string, includeInactive = false) {
    let query = this.supabase
      .from('expense_categories_v2')
      .select(SELECT)
      .eq('tenant_id', tenantId)
      .order('name');
    if (!includeInactive) query = query.eq('is_active', true);

    const { data, error } = await query;
    if (error) throw error;
    return data ?? [];
  }

  async create(
    tenantId: string,
    createdBy: string,
    dto: CreateExpenseCategoryDto,
  ) {
    const { data, error } = await this.supabase
      .from('expense_categories_v2')
      .insert({
        tenant_id: tenantId,
        name: dto.name,
        code: dto.code ?? null,
        description: dto.description ?? null,
        created_by: createdBy,
      })
      .select(SELECT)
      .single();

    if (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('A category with this name already exists');
      }
      throw error;
    }
    return data;
  }

  async update(tenantId: string, id: string, dto: UpdateExpenseCategoryDto) {
    const { data, error } = await this.supabase
      .from('expense_categories_v2')
      .update({ ...dto, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select(SELECT)
      .maybeSingle();

    if (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('A category with this name already exists');
      }
      throw error;
    }
    if (!data) throw new NotFoundException('Category not found');
    return data;
  }

  // DELETE is unconditionally blocked at the DB level (guard trigger,
  // 197_new_expenses_database_foundation.sql) — deactivation is the only
  // operation that can ever succeed once a category may have been used.
  async deactivate(tenantId: string, id: string) {
    return this.update(tenantId, id, { is_active: false });
  }
}
