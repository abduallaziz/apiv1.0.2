import { Injectable, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';

@Injectable()
export class ExpenseCategoriesService {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async findAll(tenantId: string) {
    const { data, error } = await this.supabase
      .from('expense_categories')
      .select('id, name, is_active, created_at')
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .order('name');
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async create(tenantId: string, name: string) {
    const { data, error } = await this.supabase
      .from('expense_categories')
      .insert({ tenant_id: tenantId, name, is_active: true })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async update(id: string, tenantId: string, dto: { name?: string; is_active?: boolean }) {
    const { data, error } = await this.supabase
      .from('expense_categories')
      .update(dto)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async remove(id: string, tenantId: string) {
    const { error } = await this.supabase
      .from('expense_categories')
      .update({ deleted_at: new Date().toISOString(), is_active: false })
      .eq('id', id)
      .eq('tenant_id', tenantId);
    if (error) throw new Error(error.message);
  }
}