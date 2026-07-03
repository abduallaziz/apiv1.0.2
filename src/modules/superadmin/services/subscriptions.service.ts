import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../../shared/supabase/supabase.module';
import { BillingService } from '../../../core/billing/billing.service';
import { BillingCycle } from '../../../core/billing/billing.types';
import { ManualPaymentDto } from '../dto/manual-payment.dto';

@Injectable()
export class SuperAdminSubscriptionsService {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
    private readonly billingService: BillingService,
  ) {}

  async findAll(filters: { status?: string; search?: string }) {
    let query = this.supabase
      .from('subscriptions')
      .select('*, tenants(name), plans(name)')
      .order('created_at', { ascending: false });

    if (filters.status) query = query.eq('status', filters.status);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    let rows = (data ?? []).map((row: any) => ({
      id: row.id,
      tenant_id: row.tenant_id,
      tenant_name: row.tenants?.name ?? null,
      plan_id: row.plan_id,
      plan_name: row.plans?.name ?? null,
      status: row.status,
      billing_cycle: row.billing_cycle,
      started_at: row.started_at,
      current_period_end: row.current_period_end ?? null,
      cancelled_at: row.cancelled_at ?? null,
      trial_ends_at: row.trial_ends_at ?? null,
    }));

    if (filters.search) {
      const term = filters.search.toLowerCase();
      rows = rows.filter((r) => r.tenant_name?.toLowerCase().includes(term));
    }

    return rows;
  }

  async cancel(subscriptionId: string): Promise<{ success: true }> {
    await this.billingService.cancelSubscriptionById(subscriptionId);
    return { success: true };
  }

  async manualPayment(dto: ManualPaymentDto): Promise<{ success: true }> {
    const { email, name } = await this.getTenantOwnerData(dto.tenant_id);
    const cycle = dto.billing_cycle === 'yearly' ? BillingCycle.YEARLY : BillingCycle.MONTHLY;

    await this.billingService.activateSubscription(
      dto.tenant_id,
      dto.plan_id,
      cycle,
      email,
      name,
      dto.amount,
    );

    return { success: true };
  }

  private async getTenantOwnerData(tenantId: string): Promise<{ email: string; name: string }> {
    const { data: tenant, error: tenantError } = await this.supabase
      .from('tenants')
      .select('name')
      .eq('id', tenantId)
      .single();
    if (tenantError || !tenant) throw new NotFoundException('Tenant not found');

    const { data: owner, error: ownerError } = await this.supabase
      .from('users')
      .select('email')
      .eq('tenant_id', tenantId)
      .eq('role', 'owner')
      .is('deleted_at', null)
      .limit(1)
      .single();
    if (ownerError || !owner) throw new NotFoundException('Tenant owner not found');

    return { email: owner.email, name: tenant.name };
  }
}
