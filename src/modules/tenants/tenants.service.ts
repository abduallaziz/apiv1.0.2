import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ALL_PAYMENT_METHODS } from './payment-methods';
import { TenantsRepository } from './repositories/tenants.repository';
import { UpdateTenantProfileDto } from './dto/update-tenant-profile.dto';
import { AuditService } from '../../core/audit/audit.service';
import { BillingService } from '../../core/billing/billing.service';

@Injectable()
export class TenantsService {
  constructor(
    private readonly tenantsRepository: TenantsRepository,
    private readonly auditService: AuditService,
    private readonly billingService: BillingService,
  ) {}

  async getProfile(tenantId: string) {
    const tenant = await this.tenantsRepository.findById(tenantId);
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  async updateProfile(
    tenantId: string,
    dto: UpdateTenantProfileDto,
    actorId?: string,
  ) {
    const tenant = await this.tenantsRepository.findById(tenantId);
    if (!tenant) throw new NotFoundException('Tenant not found');
    if (
      dto.enabled_payment_methods &&
      !dto.enabled_payment_methods.includes('cash')
    ) {
      throw new BadRequestException('Cash payment cannot be disabled');
    }
    const updated = await this.tenantsRepository.updateProfile(tenantId, dto);
    // Manual audit call — sensitive tenant configuration change, captures
    // before_data (previous settings) which the interceptor alone never does.
    if (actorId) {
      await this.auditService
        .log({
          tenant_id: tenantId,
          actor_id: actorId,
          action: 'tenant_settings.updated',
          resource_type: 'tenant_settings',
          resource_id: tenantId,
          before_data: tenant,
          after_data: updated,
        })
        .catch(() => {});
    }
    return updated;
  }

  async getSubscription(tenantId: string) {
    const tenant = await this.tenantsRepository.findById(tenantId);
    if (!tenant) throw new NotFoundException('Tenant not found');

    const subscription = await this.tenantsRepository.getSubscription(tenantId);

    return {
      tenant_status: tenant.status,
      trial_ends_at: tenant.trial_ends_at,
      subscription: subscription ?? null,
    };
  }

  async getPosConfig(tenantId: string) {
    const tenant = await this.tenantsRepository.findById(tenantId);
    if (!tenant) throw new NotFoundException('Tenant not found');
    return {
      tax_rate: tenant.tax_rate,
      tax_inclusive_pricing: tenant.tax_inclusive_pricing ?? false,
      customer_capture_enabled: tenant.customer_capture_enabled,
      name_field_enabled: tenant.name_field_enabled,
      loyalty_enabled: tenant.loyalty_enabled,
      // Currency value of one redeemed point (same default as LoyaltyService),
      // so the payment screen can preview the points discount.
      loyalty_redemption_value:
        (tenant as { loyalty_redemption_value?: number })
          .loyalty_redemption_value ?? 0.01,
      enabled_payment_methods:
        (tenant as { enabled_payment_methods?: string[] })
          .enabled_payment_methods ?? [...ALL_PAYMENT_METHODS],
    };
  }

  async getUsage(tenantId: string) {
    const tenant = await this.tenantsRepository.findById(tenantId);
    if (!tenant) throw new NotFoundException('Tenant not found');

    // max_users/max_branches MUST come from the same authoritative
    // resolution BillingService.checkBranchLimit()/checkUserLimit() use
    // (active-subscription only), not from TenantsRepository.getSubscription()'s
    // unfiltered "latest subscription row" query — that query can return a
    // cancelled/expired subscription's plan limits while enforcement correctly
    // sees no active subscription (limits of 0), producing a UI/backend mismatch.
    //
    // branches.used likewise MUST come from BillingService.countActiveBranches(),
    // not TenantsRepository.countBranches() — that query counted every
    // non-deleted branch including deactivated ones, so a tenant with an
    // inactive-but-not-deleted branch could see a "used" number here higher
    // than what checkBranchLimit() actually enforces against.
    const [planLimits, usersCount, branchesCount, invoicesThisMonth] =
      await Promise.all([
        this.billingService.getPlanLimits(tenantId),
        this.tenantsRepository.countUsers(tenantId),
        this.billingService.countActiveBranches(tenantId),
        this.tenantsRepository.countInvoicesThisMonth(tenantId),
      ]);

    return {
      users: {
        used: usersCount,
        limit: planLimits.max_users === -1 ? null : planLimits.max_users,
      },
      branches: {
        used: branchesCount,
        limit: planLimits.max_branches === -1 ? null : planLimits.max_branches,
      },
      invoices_this_month: {
        used: invoicesThisMonth,
        limit: null,
      },
    };
  }
}
