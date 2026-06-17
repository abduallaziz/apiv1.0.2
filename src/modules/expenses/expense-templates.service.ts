import { Injectable, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';

@Injectable()
export class ExpenseTemplatesService {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async findAll(tenantId: string) {
    const { data, error } = await this.supabase
      .from('expense_templates')
      .select('*')
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .order('name');
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async update(
    id: string,
    tenantId: string,
    dto: {
      name?: string;
      default_amount?: number | null;
      requires_photo?: boolean;
      expiry_hours?: number;
      is_active?: boolean;
      is_pre_approved?: boolean;
      recurrence_type?: string;
      recurrence_day?: number | null;
      next_run_at?: string | null;
    },
  ) {
    const { data, error } = await this.supabase
      .from('expense_templates')
      .update({ ...dto, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }
}