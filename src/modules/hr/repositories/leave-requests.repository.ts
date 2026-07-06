import { Injectable, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../../shared/supabase/supabase.module';

const SELECT = 'id, leave_type, date_from, date_to, days_count, status, reason, created_at';

@Injectable()
export class LeaveRequestsRepository {
  constructor(@Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient) {}

  async findRecentForUser(tenantId: string, userId: string, limit = 3) {
    const { data, error } = await this.supabase
      .from('leave_requests')
      .select(SELECT)
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)
      .order('date_from', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data ?? [];
  }

  async create(
    tenantId: string,
    userId: string,
    data: { leave_type: string; date_from: string; date_to: string; reason?: string },
  ) {
    const daysCount = Math.round(
      (new Date(data.date_to).getTime() - new Date(data.date_from).getTime()) / 86400000,
    ) + 1;
    const { data: row, error } = await this.supabase
      .from('leave_requests')
      .insert({
        tenant_id: tenantId,
        user_id: userId,
        leave_type: data.leave_type,
        date_from: data.date_from,
        date_to: data.date_to,
        days_count: daysCount,
        status: 'pending',
        reason: data.reason ?? null,
      })
      .select(SELECT)
      .single();
    if (error) throw error;
    return row;
  }

  async sumApprovedDaysThisYear(tenantId: string, userId: string): Promise<number> {
    const yearStart = `${new Date().getFullYear()}-01-01`;
    const { data, error } = await this.supabase
      .from('leave_requests')
      .select('days_count')
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)
      .eq('status', 'approved')
      .gte('date_from', yearStart);
    if (error) throw error;
    return (data ?? []).reduce((sum, r: any) => sum + r.days_count, 0);
  }
}
