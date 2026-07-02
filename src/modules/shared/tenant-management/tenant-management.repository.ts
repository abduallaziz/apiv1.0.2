import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../../shared/supabase/supabase.module';

@Injectable()
export class TenantManagementRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  private async enrichTenant(tenant: any) {
    const [ownerRes, usersRes, branchesRes, subRes] = await Promise.all([
      this.supabase
        .from('users')
        .select('name, email')
        .eq('tenant_id', tenant.id)
        .eq('role', 'owner')
        .is('deleted_at', null)
        .limit(1)
        .single(),
      this.supabase
        .from('users')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenant.id)
        .is('deleted_at', null),
      this.supabase
        .from('branches')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenant.id)
        .is('deleted_at', null),
      this.supabase
        .from('subscriptions')
        .select('billing_cycle, plans(name, price_monthly, price_yearly)')
        .eq('tenant_id', tenant.id)
        .in('status', ['active', 'trial'])
        .order('created_at', { ascending: false })
        .limit(1)
        .single(),
    ]);

    const plan = (subRes.data as any)?.plans ?? null;
    const billingCycle = (subRes.data as any)?.billing_cycle ?? 'monthly';
    const mrr = plan
      ? billingCycle === 'yearly'
        ? Math.round((plan.price_yearly ?? 0) / 12)
        : (plan.price_monthly ?? 0)
      : 0;

    return {
      ...tenant,
      owner_name: ownerRes.data?.name ?? null,
      owner_email: ownerRes.data?.email ?? null,
      users_count: usersRes.count ?? 0,
      branches_count: branchesRes.count ?? 0,
      subscription_plan: plan?.name ?? null,
      mrr,
    };
  }

  async findAll(params: {
    page: number;
    limit: number;
    search?: string;
    status?: string;
  }) {
    let query = this.supabase
      .from('tenants')
      .select('*', { count: 'exact' })
      .is('deleted_at', null);

    if (params.search) {
      query = query.ilike('name', `%${params.search}%`);
    }
    if (params.status) {
      query = query.eq('status', params.status);
    }

    const from = (params.page - 1) * params.limit;
    const to = from + params.limit - 1;
    query = query.range(from, to).order('created_at', { ascending: false });

    const { data, error, count } = await query;
    if (error) throw error;

    const enriched = await Promise.all((data ?? []).map((t) => this.enrichTenant(t)));

    return { data: enriched, count: count ?? 0 };
  }

  async findById(tenantId: string) {
    const { data, error } = await this.supabase
      .from('tenants')
      .select('*')
      .eq('id', tenantId)
      .is('deleted_at', null)
      .single();
    if (error) throw error;
    return this.enrichTenant(data);
  }

  async updateStatus(tenantId: string, status: string) {
    const { data, error } = await this.supabase
      .from('tenants')
      .update({ status })
      .eq('id', tenantId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async softDelete(tenantId: string) {
    const { data, error } = await this.supabase
      .from('tenants')
      .update({ deleted_at: new Date().toISOString(), status: 'cancelled' })
      .eq('id', tenantId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async getStats(tenantId: string) {
    const [usersRes, branchesRes, invoicesRes] = await Promise.all([
      this.supabase
        .from('users')
        .select('id', { count: 'exact' })
        .eq('tenant_id', tenantId)
        .is('deleted_at', null),
      this.supabase
        .from('branches')
        .select('id', { count: 'exact' })
        .eq('tenant_id', tenantId)
        .is('deleted_at', null),
      this.supabase
        .from('orders')
        .select('id', { count: 'exact' })
        .eq('tenant_id', tenantId),
    ]);
    return {
      users_count: usersRes.count ?? 0,
      branches_count: branchesRes.count ?? 0,
      invoices_count: invoicesRes.count ?? 0,
    };
  }

  async getFeatureOverrides(tenantId: string) {
    const { data, error } = await this.supabase
      .from('tenant_feature_overrides')
      .select('*')
      .eq('tenant_id', tenantId);
    if (error) throw error;
    return data ?? [];
  }

  async upsertFeatureOverride(params: {
    tenantId: string;
    featureKey: string;
    isEnabled: boolean;
    limitValue?: number;
    overriddenBy: string;
    note?: string;
  }) {
    const { data, error } = await this.supabase
      .from('tenant_feature_overrides')
      .upsert(
        {
          tenant_id: params.tenantId,
          feature_key: params.featureKey,
          is_enabled: params.isEnabled,
          limit_value: params.limitValue ?? null,
          overridden_by: params.overriddenBy,
          overridden_at: new Date().toISOString(),
          note: params.note ?? null,
        },
        { onConflict: 'tenant_id,feature_key' },
      )
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async getSubscription(tenantId: string) {
    const { data, error } = await this.supabase
      .from('subscriptions')
      .select('*, plans(*)')
      .eq('tenant_id', tenantId)
      .in('status', ['active', 'trial'])
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    if (error && error.code !== 'PGRST116') throw error;
    return data ?? null;
  }

  async extendTrial(tenantId: string, days: number) {
    const sub = await this.getSubscription(tenantId);
    const currentEnd = sub?.ends_at ? new Date(sub.ends_at) : new Date();
    const newEnd = new Date(currentEnd.getTime() + days * 24 * 60 * 60 * 1000);

    const { data, error } = await this.supabase
      .from('subscriptions')
      .update({ ends_at: newEnd.toISOString(), status: 'trial' })
      .eq('tenant_id', tenantId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }
}