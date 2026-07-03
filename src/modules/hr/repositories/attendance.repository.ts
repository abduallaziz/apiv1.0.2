import { Injectable, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../../shared/supabase/supabase.module';
import { TenantContext } from '../../../core/tenant/tenant-context';

@Injectable()
export class AttendanceRepository {
  constructor(@Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient) {}

  async findOpenRecord(tenantId: string, userId: string) {
    const { data, error } = await this.supabase
      .from('attendance_records')
      .select('id, check_in_at')
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)
      .is('check_out_at', null)
      .maybeSingle();
    if (error) throw error;
    return data;
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

  async checkIn(tenantId: string, userId: string, branchId: string | null) {
    const { data, error } = await this.supabase
      .from('attendance_records')
      .insert({ tenant_id: tenantId, user_id: userId, branch_id: branchId })
      .select('id, check_in_at, branch_id')
      .single();
    if (error) throw error;
    return data;
  }

  async checkOut(tenantId: string, recordId: string) {
    const { data, error } = await this.supabase
      .from('attendance_records')
      .update({ check_out_at: new Date().toISOString() })
      .eq('tenant_id', tenantId)
      .eq('id', recordId)
      .select('id, check_in_at, check_out_at, branch_id')
      .single();
    if (error) throw error;
    return data;
  }

  async findAll(
    tenant: TenantContext,
    filters: { userId?: string; branchId?: string; from?: string; to?: string },
  ) {
    let q = this.supabase
      .from('attendance_records')
      .select('id, user_id, branch_id, check_in_at, check_out_at, users(name)')
      .eq('tenant_id', tenant.tenantId)
      .order('check_in_at', { ascending: false });

    if (filters.userId) q = q.eq('user_id', filters.userId);
    if (filters.branchId) q = q.eq('branch_id', filters.branchId);
    if (filters.from) q = q.gte('check_in_at', filters.from);
    if (filters.to) q = q.lte('check_in_at', filters.to);

    const { data, error } = await q;
    if (error) throw error;

    return (data ?? []).map((r: any) => ({
      id: r.id,
      user_id: r.user_id,
      user_name: r.users?.name ?? null,
      branch_id: r.branch_id,
      check_in_at: r.check_in_at,
      check_out_at: r.check_out_at,
      hours_worked: r.check_out_at
        ? parseFloat(((new Date(r.check_out_at).getTime() - new Date(r.check_in_at).getTime()) / 3600000).toFixed(2))
        : null,
    }));
  }
}
