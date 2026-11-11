import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';
import { isUniqueViolation } from '../../shared/supabase/postgrest-error.util';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';

const SELECT = 'id, name, code, description, is_active, created_at, updated_at';

@Injectable()
export class ExpenseDepartmentsService {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async findAll(tenantId: string, includeInactive = false) {
    let query = this.supabase
      .from('expense_departments')
      .select(SELECT)
      .eq('tenant_id', tenantId)
      .order('name');
    if (!includeInactive) query = query.eq('is_active', true);

    const { data, error } = await query;
    if (error) throw error;
    return data ?? [];
  }

  async create(tenantId: string, createdBy: string, dto: CreateDepartmentDto) {
    const { data, error } = await this.supabase
      .from('expense_departments')
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
        throw new ConflictException(
          'A department with this name already exists',
        );
      }
      throw error;
    }
    return data;
  }

  async update(tenantId: string, id: string, dto: UpdateDepartmentDto) {
    const { data, error } = await this.supabase
      .from('expense_departments')
      .update({ ...dto, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select(SELECT)
      .maybeSingle();

    if (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          'A department with this name already exists',
        );
      }
      throw error;
    }
    if (!data) throw new NotFoundException('Department not found');
    return data;
  }

  // The only way to retire a Department once it may have been referenced —
  // DELETE is unconditionally blocked at the DB level (guard trigger,
  // 197_new_expenses_database_foundation.sql), so this is not a policy
  // choice made here, it's the only operation that can ever succeed.
  async deactivate(tenantId: string, id: string) {
    return this.update(tenantId, id, { is_active: false });
  }
}
