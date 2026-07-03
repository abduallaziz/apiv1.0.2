import { Injectable, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../../shared/supabase/supabase.module';
import { TenantContext } from '../../../core/tenant/tenant-context';

const SELECT = 'id, user_id, branch_id, scheduled_date, start_time, end_time, notes, created_at, users(name)';

@Injectable()
export class SchedulesRepository {
  constructor(@Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient) {}

  private map(row: any) {
    return {
      id: row.id,
      user_id: row.user_id,
      user_name: row.users?.name ?? null,
      branch_id: row.branch_id,
      scheduled_date: row.scheduled_date,
      start_time: row.start_time,
      end_time: row.end_time,
      notes: row.notes,
      created_at: row.created_at,
    };
  }

  async findAll(
    tenant: TenantContext,
    filters: { userId?: string; branchId?: string; from?: string; to?: string },
  ) {
    let q = this.supabase
      .from('work_schedules')
      .select(SELECT)
      .eq('tenant_id', tenant.tenantId)
      .order('scheduled_date', { ascending: true });

    if (filters.userId) q = q.eq('user_id', filters.userId);
    if (filters.branchId) q = q.eq('branch_id', filters.branchId);
    if (filters.from) q = q.gte('scheduled_date', filters.from);
    if (filters.to) q = q.lte('scheduled_date', filters.to);

    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map((r) => this.map(r));
  }

  async findById(id: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('work_schedules')
      .select(SELECT)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error) throw error;
    return data ? this.map(data) : null;
  }

  async create(tenantId: string, dto: object) {
    const { data, error } = await this.supabase
      .from('work_schedules')
      .insert({ ...dto, tenant_id: tenantId })
      .select(SELECT)
      .single();
    if (error) throw error;
    return this.map(data);
  }

  async update(id: string, tenantId: string, dto: object) {
    const { data, error } = await this.supabase
      .from('work_schedules')
      .update(dto)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select(SELECT)
      .single();
    if (error) throw error;
    return this.map(data);
  }

  async remove(id: string, tenantId: string) {
    const { error } = await this.supabase
      .from('work_schedules')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId);
    if (error) throw error;
  }

  async userBelongsToTenant(userId: string, tenantId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('users')
      .select('id')
      .eq('id', userId)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw error;
    return !!data;
  }

  async branchBelongsToTenant(branchId: string, tenantId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('branches')
      .select('id')
      .eq('id', branchId)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw error;
    return !!data;
  }
}
