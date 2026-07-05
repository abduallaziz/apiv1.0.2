import { Injectable, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../../shared/supabase/supabase.module';

const SELECT = 'id, tenant_id, name, days_of_week, start_time, end_time, day_overrides, created_at, updated_at';

@Injectable()
export class ShiftPatternsRepository {
  constructor(@Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient) {}

  async findAll(tenantId: string) {
    const { data, error } = await this.supabase
      .from('shift_patterns')
      .select(SELECT)
      .eq('tenant_id', tenantId)
      .order('name', { ascending: true });
    if (error) throw error;
    return data ?? [];
  }

  async findById(id: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('shift_patterns')
      .select(SELECT)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async create(tenantId: string, dto: object) {
    const { data, error } = await this.supabase
      .from('shift_patterns')
      .insert({ ...dto, tenant_id: tenantId })
      .select(SELECT)
      .single();
    if (error) throw error;
    return data;
  }

  async update(id: string, tenantId: string, dto: object) {
    const { data, error } = await this.supabase
      .from('shift_patterns')
      .update(dto)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select(SELECT)
      .single();
    if (error) throw error;
    return data;
  }

  async remove(id: string, tenantId: string) {
    const { error } = await this.supabase
      .from('shift_patterns')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId);
    if (error) throw error;
  }

  async findAssignedUserIds(patternId: string, tenantId: string): Promise<string[]> {
    const { data, error } = await this.supabase
      .from('users')
      .select('id')
      .eq('shift_pattern_id', patternId)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null);
    if (error) throw error;
    return (data ?? []).map((r: any) => r.id);
  }

  async updateUsersSchedule(userIds: string[], tenantId: string, fields: Record<string, any>) {
    const { error } = await this.supabase
      .from('users')
      .update(fields)
      .in('id', userIds)
      .eq('tenant_id', tenantId);
    if (error) throw error;
  }
}
