import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../../shared/supabase/supabase.module';

@Injectable()
export class TenantsRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async findById(tenantId: string) {
    const { data, error } = await this.supabase
      .from('tenants')
      .select('id, name, business_type, status, trial_ends_at, created_at')
      .eq('id', tenantId)
      .is('deleted_at', null)
      .single();

    if (error) throw error;
    return data;
  }

  async updateProfile(tenantId: string, updates: { name?: string; business_type?: string }) {
    const { data, error } = await this.supabase
      .from('tenants')
      .update(updates)
      .eq('id', tenantId)
      .is('deleted_at', null)
      .select('id, name, business_type, status, trial_ends_at, created_at')
      .single();

    if (error) throw error;
    return data;
  }

  async getSubscription(tenantId: string) {
    const { data, error } = await this.supabase
      .from('subscriptions')
      .select(`
        id,
        status,
        plan_id,
        started_at,
        expires_at,
        cancelled_at,
        trial_ends_at,
        max_users,
        max_branches,
        billing_cycle,
        current_period_start,
        current_period_end
      `)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data ?? null;
  }

  async countUsers(tenantId: string): Promise<number> {
    const { count, error } = await this.supabase
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .is('deleted_at', null);

    if (error) throw error;
    return count ?? 0;
  }

  async countBranches(tenantId: string): Promise<number> {
    const { count, error } = await this.supabase
      .from('branches')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .is('deleted_at', null);

    if (error) throw error;
    return count ?? 0;
  }

  async countInvoicesThisMonth(tenantId: string): Promise<number> {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const { count, error } = await this.supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .gte('created_at', startOfMonth.toISOString());

    if (error) throw error;
    return count ?? 0;
  }
}