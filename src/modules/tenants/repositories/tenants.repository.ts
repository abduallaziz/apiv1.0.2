import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../../shared/supabase/supabase.module';

@Injectable()
export class TenantsRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  private static readonly PROFILE_COLUMNS =
    'id, name, business_type, activity, status, trial_ends_at, created_at, currency_code, currency_symbol, tax_rate, customer_capture_enabled, name_field_enabled, logo_url, tax_number, invoice_footer, printer_settings, notification_preferences, loyalty_points_per_currency, loyalty_redemption_value, loyalty_enabled';

  async findById(tenantId: string) {
    const { data, error } = await this.supabase
      .from('tenants')
      .select(TenantsRepository.PROFILE_COLUMNS)
      .eq('id', tenantId)
      .is('deleted_at', null)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  async getTaxRate(tenantId: string): Promise<number> {
    const { data, error } = await this.supabase
      .from('tenants')
      .select('tax_rate')
      .eq('id', tenantId)
      .is('deleted_at', null)
      .single();

    if (error || !data) return 0;
    return data.tax_rate ?? 0;
  }

  async updateProfile(tenantId: string, updates: {
    name?: string;
    business_type?: string;
    currency_code?: string;
    currency_symbol?: string;
    tax_rate?: number;
    customer_capture_enabled?: boolean;
    name_field_enabled?: boolean;
    logo_url?: string;
    tax_number?: string;
    invoice_footer?: string;
    printer_settings?: object;
    notification_preferences?: object;
    loyalty_points_per_currency?: number;
    loyalty_redemption_value?: number;
    loyalty_enabled?: boolean;
  }) {
    const { data, error } = await this.supabase
      .from('tenants')
      .update(updates)
      .eq('id', tenantId)
      .is('deleted_at', null)
      .select(TenantsRepository.PROFILE_COLUMNS)
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
        current_period_end,
        cancelled_at,
        trial_ends_at,
        billing_cycle,
        current_period_start,
        plans(max_users, max_branches, name, price_monthly, price_yearly)
      `)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    if (!data) return null;

    const plan = (data as any).plans ?? {};
    return {
      id: data.id,
      status: data.status,
      plan_id: data.plan_id,
      plan_name: plan.name ?? null,
      started_at: data.started_at,
      expires_at: data.current_period_end ?? null,
      current_period_end: data.current_period_end,
      current_period_start: data.current_period_start,
      cancelled_at: data.cancelled_at,
      trial_ends_at: data.trial_ends_at,
      billing_cycle: data.billing_cycle,
      max_users: plan.max_users ?? 0,
      max_branches: plan.max_branches ?? 0,
    };
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