import { Injectable, ForbiddenException, NotFoundException, Inject, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';
import {
  SubscriptionStatus,
  BillingCycle,
  PlanLimits,
  SubscriptionRecord,
  PlanRecord,
} from './billing.types';
import { BillingInvoiceService } from './billing-invoice.service';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
    private readonly billingInvoiceService: BillingInvoiceService,
  ) {}

  async initTrialSubscription(tenantId: string, planId: string): Promise<SubscriptionRecord> {
    const plan = await this.getPlanById(planId);
    const now = new Date();
    const trialEndsAt = new Date(now);
    trialEndsAt.setDate(trialEndsAt.getDate() + plan.trial_days);

    const { data, error } = await this.supabase
      .from('subscriptions')
      .insert({
        tenant_id: tenantId,
        plan_id: planId,
        status: SubscriptionStatus.TRIAL,
        billing_cycle: BillingCycle.MONTHLY,
        started_at: now.toISOString(),
        trial_ends_at: trialEndsAt.toISOString(),
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to init trial: ${error.message}`);
    return data;
  }

  async getActiveSubscription(tenantId: string): Promise<SubscriptionRecord | null> {
    const { data, error } = await this.supabase
      .from('subscriptions')
      .select('*')
      .eq('tenant_id', tenantId)
      .in('status', [
        SubscriptionStatus.TRIAL,
        SubscriptionStatus.ACTIVE,
        SubscriptionStatus.GRACE_PERIOD,
      ])
      .order('created_at', { ascending: false })
      .limit(1);

    if (error || !data || data.length === 0) return null;
    return data[0];
  }

  async isSubscriptionActive(tenantId: string): Promise<boolean> {
    const sub = await this.getActiveSubscription(tenantId);
    if (!sub) return false;

    const now = new Date();

    if (sub.status === SubscriptionStatus.TRIAL) {
      if (!sub.trial_ends_at) return true;
      return new Date(sub.trial_ends_at) > now;
    }

    if (sub.status === SubscriptionStatus.ACTIVE) {
      if (!sub.current_period_end) return true;
      return new Date(sub.current_period_end) > now;
    }

    if (sub.status === SubscriptionStatus.GRACE_PERIOD) {
      if (!sub.grace_period_ends_at) return false;
      return new Date(sub.grace_period_ends_at) > now;
    }

    return false;
  }

  async getPlanLimits(tenantId: string): Promise<PlanLimits> {
    const sub = await this.getActiveSubscription(tenantId);
    if (!sub) return { max_users: 0, max_branches: 0 };

    const plan = await this.getPlanById(sub.plan_id);
    return {
      max_users: plan.max_users,
      max_branches: plan.max_branches,
    };
  }

  async checkUserLimit(tenantId: string): Promise<void> {
    const limits = await this.getPlanLimits(tenantId);
    if (limits.max_users === -1) return;

    const { count, error } = await this.supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .eq('is_active', true);

    if (error) throw new Error(error.message);
    if ((count ?? 0) >= limits.max_users) {
      throw new ForbiddenException(
        `User limit reached. Your plan allows ${limits.max_users} users.`,
      );
    }
  }

  async checkBranchLimit(tenantId: string): Promise<void> {
    const limits = await this.getPlanLimits(tenantId);
    if (limits.max_branches === -1) return;

    const { count, error } = await this.supabase
      .from('branches')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .eq('is_active', true);

    if (error) throw new Error(error.message);
    if ((count ?? 0) >= limits.max_branches) {
      throw new ForbiddenException(
        `Branch limit reached. Your plan allows ${limits.max_branches} branches.`,
      );
    }
  }

  async getPlanById(planId: string): Promise<PlanRecord> {
    const { data, error } = await this.supabase
      .from('plans')
      .select('*')
      .eq('id', planId)
      .single();

    if (error || !data) throw new Error(`Plan not found: ${planId}`);
    return data;
  }

  async getActivePlans(): Promise<PlanRecord[]> {
    const { data, error } = await this.supabase
      .from('plans')
      .select('*')
      .eq('is_active', true)
      .order('price_monthly', { ascending: true });

    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async extendTrial(tenantId: string, days: number): Promise<void> {
    const sub = await this.getActiveSubscription(tenantId);
    if (!sub) throw new Error('No active subscription found');

    const currentEnd = sub.trial_ends_at ? new Date(sub.trial_ends_at) : new Date();
    currentEnd.setDate(currentEnd.getDate() + days);

    const { error } = await this.supabase
      .from('subscriptions')
      .update({
        trial_ends_at: currentEnd.toISOString(),
        status: SubscriptionStatus.TRIAL,
        updated_at: new Date().toISOString(),
      })
      .eq('id', sub.id);

    if (error) throw new Error(error.message);
  }

  async activateSubscription(
    tenantId: string,
    planId: string,
    cycle: BillingCycle,
    tenantEmail: string,
    tenantName: string,
    customAmount?: number,
  ): Promise<void> {
    const plan = await this.getPlanById(planId);
    const sub = await this.getActiveSubscription(tenantId);
    const now = new Date();

    const periodEnd = new Date(now);
    if (cycle === BillingCycle.YEARLY) {
      periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    } else {
      periodEnd.setMonth(periodEnd.getMonth() + 1);
    }

    let subscriptionId: string;

    if (sub) {
      const { error } = await this.supabase
        .from('subscriptions')
        .update({
          plan_id: planId,
          status: SubscriptionStatus.ACTIVE,
          billing_cycle: cycle,
          current_period_start: now.toISOString(),
          current_period_end: periodEnd.toISOString(),
          updated_at: now.toISOString(),
        })
        .eq('id', sub.id);

      if (error) throw new Error(error.message);
      subscriptionId = sub.id;
    } else {
      const { data, error } = await this.supabase
        .from('subscriptions')
        .insert({
          tenant_id: tenantId,
          plan_id: planId,
          status: SubscriptionStatus.ACTIVE,
          billing_cycle: cycle,
          started_at: now.toISOString(),
          current_period_start: now.toISOString(),
          current_period_end: periodEnd.toISOString(),
        })
        .select()
        .single();

      if (error || !data) throw new Error(error?.message ?? 'Failed to create subscription');
      subscriptionId = data.id;
    }

    // Generate invoice
    const planPrice = customAmount ?? (cycle === BillingCycle.YEARLY ? plan.price_yearly : plan.price_monthly);
    const { invoiceId } = await this.billingInvoiceService.generateInvoice({
      tenantId,
      subscriptionId,
      planName: plan.name,
      planPrice,
      currency: 'USD',
      periodStart: now,
      periodEnd,
      tenantEmail,
      tenantName,
    });

    // Process payment
    await this.billingInvoiceService.processPayment({
      tenantId,
      invoiceId,
      tenantEmail,
      tenantName,
    });
  }

  async cancelSubscription(tenantId: string): Promise<void> {
    const sub = await this.getActiveSubscription(tenantId);
    if (!sub) throw new Error('No active subscription');

    const { error } = await this.supabase
      .from('subscriptions')
      .update({
        status: SubscriptionStatus.CANCELLED,
        cancelled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', sub.id);

    if (error) throw new Error(error.message);
  }

  /** Superadmin path: cancel a specific subscription by its own id, regardless of tenant. */
  async cancelSubscriptionById(subscriptionId: string): Promise<void> {
    const { error, count } = await this.supabase
      .from('subscriptions')
      .update(
        {
          status: SubscriptionStatus.CANCELLED,
          cancelled_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { count: 'exact' },
      )
      .eq('id', subscriptionId);

    if (error) throw new Error(error.message);
    if (!count) throw new NotFoundException('Subscription not found');
  }

  @Cron(CronExpression.EVERY_HOUR)
  async handleSubscriptionExpiry(): Promise<void> {
    const now = new Date().toISOString();

    const { error: trialError } = await this.supabase
      .from('subscriptions')
      .update({
        status: SubscriptionStatus.SUSPENDED,
        suspended_at: now,
        updated_at: now,
      })
      .eq('status', SubscriptionStatus.TRIAL)
      .lt('trial_ends_at', now);

    if (trialError) {
      this.logger.error(`Trial expiry cron error: ${trialError.message}`);
    }

    const { error: graceError } = await this.supabase
      .from('subscriptions')
      .update({
        status: SubscriptionStatus.SUSPENDED,
        suspended_at: now,
        updated_at: now,
      })
      .eq('status', SubscriptionStatus.GRACE_PERIOD)
      .lt('grace_period_ends_at', now);

    if (graceError) {
      this.logger.error(`Grace period expiry cron error: ${graceError.message}`);
    }

    this.logger.log('Subscription expiry check completed');
  }
}