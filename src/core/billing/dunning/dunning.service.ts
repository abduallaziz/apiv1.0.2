import { Injectable, Logger, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../../shared/supabase/supabase.module';
import {
  DUNNING_GRACE_PERIOD_DAYS,
  DUNNING_MAX_ATTEMPTS,
  DUNNING_RETRY_INTERVALS_HOURS,
} from './dunning.constants';
import { DunningResult } from '../interfaces/dunning-result.interface';
import { PAYMENT_PROVIDER } from '../billing.constants';
import { PaymentProvider } from '../providers/payment-provider.interface';

@Injectable()
export class DunningService {
  private readonly logger = new Logger(DunningService.name);

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
    @Inject(PAYMENT_PROVIDER) private readonly paymentProvider: PaymentProvider,
  ) {}

  async processFailedPayments(): Promise<void> {
    this.logger.log('Running dunning check...');

    const { data: failedSubs, error } = await this.supabase
      .from('subscriptions')
      .select('id, tenant_id, plan_id, status')
      .eq('status', 'past_due')
      .is('deleted_at', null);

    if (error) {
      this.logger.error('Failed to fetch past_due subscriptions', error.message);
      return;
    }

    if (!failedSubs || failedSubs.length === 0) {
      this.logger.log('No past_due subscriptions found.');
      return;
    }

    for (const sub of failedSubs) {
      await this.handleDunningForSubscription(sub.id, sub.tenant_id);
    }
  }

  async retryPendingAttempts(): Promise<void> {
    this.logger.log('Running retry for pending dunning attempts...');

    const now = new Date().toISOString();

    const { data: attempts, error } = await this.supabase
      .from('dunning_attempts')
      .select('*')
      .eq('status', 'pending')
      .lte('next_retry_at', now);

    if (error) {
      this.logger.error('Failed to fetch pending dunning attempts', error.message);
      return;
    }

    if (!attempts || attempts.length === 0) {
      this.logger.log('No pending retries due.');
      return;
    }

    for (const attempt of attempts) {
      await this.retryAttempt(attempt);
    }
  }

  async suspendExpiredGracePeriods(): Promise<void> {
    this.logger.log('Checking grace period expirations...');

    const graceCutoff = new Date();
    graceCutoff.setDate(graceCutoff.getDate() - DUNNING_GRACE_PERIOD_DAYS);

    const { data: exhausted, error } = await this.supabase
      .from('dunning_attempts')
      .select('tenant_id, subscription_id')
      .eq('status', 'exhausted')
      .lte('attempted_at', graceCutoff.toISOString());

    if (error) {
      this.logger.error('Failed to fetch exhausted attempts', error.message);
      return;
    }

    if (!exhausted || exhausted.length === 0) return;

    const uniqueTenants = [...new Set(exhausted.map((a) => a.tenant_id))];

    for (const tenantId of uniqueTenants) {
      await this.suspendTenant(tenantId);
    }
  }

  private async handleDunningForSubscription(
    subscriptionId: string,
    tenantId: string,
  ): Promise<DunningResult> {
    const { data: existing } = await this.supabase
      .from('dunning_attempts')
      .select('attempt_number')
      .eq('subscription_id', subscriptionId)
      .order('attempt_number', { ascending: false })
      .limit(1);

    const lastAttemptNumber = existing?.[0]?.attempt_number ?? 0;
    const nextAttemptNumber = lastAttemptNumber + 1;

    if (nextAttemptNumber > DUNNING_MAX_ATTEMPTS) {
      this.logger.warn(`Subscription ${subscriptionId} exhausted all dunning attempts.`);
      await this.markExhausted(subscriptionId, tenantId);
      return {
        tenantId,
        subscriptionId,
        attemptNumber: lastAttemptNumber,
        status: 'exhausted',
      };
    }

    const retryHours = DUNNING_RETRY_INTERVALS_HOURS[nextAttemptNumber - 1] ?? 72;
    const nextRetryAt = new Date();
    nextRetryAt.setHours(nextRetryAt.getHours() + retryHours);

    await this.supabase.from('dunning_attempts').insert({
      tenant_id: tenantId,
      subscription_id: subscriptionId,
      attempt_number: nextAttemptNumber,
      status: 'pending',
      next_retry_at: nextRetryAt.toISOString(),
    });

    this.logger.log(
      `Scheduled dunning attempt #${nextAttemptNumber} for tenant ${tenantId} at ${nextRetryAt.toISOString()}`,
    );

    return {
      tenantId,
      subscriptionId,
      attemptNumber: nextAttemptNumber,
      status: 'failed',
      nextRetryAt,
    };
  }

  private async retryAttempt(attempt: any): Promise<void> {
    this.logger.log(
      `Retrying dunning attempt #${attempt.attempt_number} for tenant ${attempt.tenant_id}`,
    );

    try {
      const { data: billingCustomer } = await this.supabase
        .from('billing_customers')
        .select('provider_customer_id')
        .eq('tenant_id', attempt.tenant_id)
        .single();

      if (!billingCustomer?.provider_customer_id) {
        throw new Error('No billing customer found');
      }

      // جلب الـ invoice المرتبطة بالـ dunning attempt
      const { data: invoice } = await this.supabase
        .from('invoices')
        .select('id, amount_due, currency')
        .eq('subscription_id', attempt.subscription_id)
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      const result = await this.paymentProvider.createPayment({
        tenantId: attempt.tenant_id,
        providerCustomerId: billingCustomer.provider_customer_id,
        invoiceId: invoice?.id ?? attempt.billing_invoice_id ?? 'unknown',
        amount: invoice?.amount_due ?? 0,
        currency: invoice?.currency ?? 'SAR',
        description: `Dunning retry #${attempt.attempt_number}`,
      });

      if (result.status === 'succeeded') {
        await this.supabase
          .from('dunning_attempts')
          .update({ status: 'succeeded' })
          .eq('id', attempt.id);

        await this.supabase
          .from('subscriptions')
          .update({ status: 'active' })
          .eq('id', attempt.subscription_id);

        this.logger.log(`Dunning succeeded for tenant ${attempt.tenant_id}`);
      } else {
        throw new Error(result.failureReason ?? 'Payment failed');
      }
    } catch (err: any) {
      this.logger.warn(
        `Dunning attempt #${attempt.attempt_number} failed for tenant ${attempt.tenant_id}: ${err.message}`,
      );

      await this.supabase
        .from('dunning_attempts')
        .update({ status: 'failed', error_message: err.message })
        .eq('id', attempt.id);

      if (attempt.attempt_number >= DUNNING_MAX_ATTEMPTS) {
        await this.markExhausted(attempt.subscription_id, attempt.tenant_id);
      }
    }
  }

  private async markExhausted(subscriptionId: string, tenantId: string): Promise<void> {
    await this.supabase
      .from('dunning_attempts')
      .update({ status: 'exhausted' })
      .eq('subscription_id', subscriptionId)
      .eq('status', 'pending');

    await this.supabase
      .from('subscriptions')
      .update({ status: 'past_due' })
      .eq('id', subscriptionId);

    this.logger.warn(`Tenant ${tenantId} marked for suspension after grace period.`);
  }

  private async suspendTenant(tenantId: string): Promise<void> {
    const { error } = await this.supabase
      .from('tenants')
      .update({ status: 'suspended' })
      .eq('id', tenantId);

    if (error) {
      this.logger.error(`Failed to suspend tenant ${tenantId}`, error.message);
      return;
    }

    this.logger.warn(`Tenant ${tenantId} has been suspended due to non-payment.`);
  }
}