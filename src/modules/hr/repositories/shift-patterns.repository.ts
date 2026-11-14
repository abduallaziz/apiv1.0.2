import { Injectable, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../../shared/supabase/supabase.module';

const SELECT =
  'id, tenant_id, branch_id, name, days_of_week, shifts, day_overrides, created_at, updated_at';

@Injectable()
export class ShiftPatternsRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async findAll(tenantId: string, branchId: string | null = null) {
    let q = this.supabase
      .from('shift_patterns')
      .select(SELECT)
      .eq('tenant_id', tenantId)
      .order('name', { ascending: true });
    if (branchId) q = q.eq('branch_id', branchId);
    const { data, error } = await q;
    if (error) throw error;
    return data ?? [];
  }

  /** Another pattern with the same name (case-insensitive) in the same branch scope. */
  async nameTaken(
    tenantId: string,
    branchId: string | null,
    name: string,
    excludeId?: string,
  ): Promise<boolean> {
    let q = this.supabase
      .from('shift_patterns')
      .select('id')
      .eq('tenant_id', tenantId)
      .ilike('name', name.replace(/[\\%_]/g, (c) => `\\${c}`));
    q = branchId ? q.eq('branch_id', branchId) : q.is('branch_id', null);
    if (excludeId) q = q.neq('id', excludeId);
    const { data, error } = await q.limit(1);
    if (error) throw error;
    return (data ?? []).length > 0;
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

  async findAssignedUserIds(
    patternId: string,
    tenantId: string,
  ): Promise<string[]> {
    const { data, error } = await this.supabase
      .from('users')
      .select('id')
      .eq('shift_pattern_id', patternId)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null);
    if (error) throw error;
    return (data ?? []).map((r: any) => r.id);
  }

  async updateUsersSchedule(
    userIds: string[],
    tenantId: string,
    fields: Record<string, any>,
  ) {
    const { error } = await this.supabase
      .from('users')
      .update(fields)
      .in('id', userIds)
      .eq('tenant_id', tenantId);
    if (error) throw error;
  }
}
