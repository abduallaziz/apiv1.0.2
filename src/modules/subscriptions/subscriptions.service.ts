import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BillingService } from '../../core/billing/billing.service';
import { BillingCycle } from '../../core/billing/billing.types';
import { TenantContext } from '../../core/tenant/tenant.context';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { SupabaseClient } from '@supabase/supabase-js';
import { Inject } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly billingService: BillingService,
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async getCurrent(tenant: TenantContext) {
    const sub = await this.billingService.getActiveSubscription(
      tenant.tenantId,
    );
    if (!sub) return { status: 'none', subscription: null };

    const isActive = await this.billingService.isSubscriptionActive(
      tenant.tenantId,
    );
    const limits = await this.billingService.getPlanLimits(tenant.tenantId);

    return { subscription: sub, isActive, limits };
  }

  async upgrade(tenant: TenantContext, dto: CreateSubscriptionDto) {
    // Reject unknown / deactivated plans before anything financial happens.
    let plan;
    try {
      plan = await this.billingService.getPlanById(dto.plan_id);
    } catch {
      throw new NotFoundException('Plan not found');
    }
    if (!plan.is_active) {
      throw new BadRequestException('Plan is not available for subscription');
    }

    // Idempotent: re-requesting the plan/cycle already paid for and still
    // running must not issue another charge.
    const cycle = dto.billing_cycle ?? BillingCycle.MONTHLY;
    const current = await this.billingService.getActiveSubscription(
      tenant.tenantId,
    );
    if (
      current &&
      current.status === 'active' &&
      current.plan_id === dto.plan_id &&
      current.billing_cycle === cycle &&
      current.current_period_end &&
      new Date(current.current_period_end) > new Date()
    ) {
      return { success: true, already_active: true };
    }

    const tenantData = await this.getTenantData(tenant.tenantId);

    await this.billingService.activateSubscription(
      tenant.tenantId,
      dto.plan_id,
      cycle,
      tenantData.email,
      tenantData.name,
    );

    return { success: true };
  }

  async cancel(tenant: TenantContext) {
    await this.billingService.cancelSubscription(tenant.tenantId);
    return { success: true };
  }

  private async getTenantData(
    tenantId: string,
  ): Promise<{ email: string; name: string }> {
    const { data, error } = await this.supabase
      .from('tenants')
      .select('name')
      .eq('id', tenantId)
      .single();

    if (error || !data) throw new NotFoundException('Tenant not found');

    const { data: owner, error: ownerError } = await this.supabase
      .from('users')
      .select('email')
      .eq('tenant_id', tenantId)
      .eq('role', 'owner')
      .is('deleted_at', null)
      .limit(1)
      .single();

    if (ownerError || !owner)
      throw new NotFoundException('Tenant owner not found');

    return { email: owner.email, name: data.name };
  }
}
