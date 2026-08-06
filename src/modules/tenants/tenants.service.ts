import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantsRepository } from './repositories/tenants.repository';
import { UpdateTenantProfileDto } from './dto/update-tenant-profile.dto';
import { AuditService } from '../../core/audit/audit.service';

@Injectable()
export class TenantsService {
  constructor(
    private readonly tenantsRepository: TenantsRepository,
    private readonly auditService: AuditService,
  ) {}

  async getProfile(tenantId: string) {
    const tenant = await this.tenantsRepository.findById(tenantId);
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  async updateProfile(tenantId: string, dto: UpdateTenantProfileDto, actorId?: string) {
    const tenant = await this.tenantsRepository.findById(tenantId);
    if (!tenant) throw new NotFoundException('Tenant not found');
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
          before_data: tenant as unknown as Record<string, unknown>,
          after_data: updated as unknown as Record<string, unknown>,
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
      customer_capture_enabled: tenant.customer_capture_enabled,
      name_field_enabled: tenant.name_field_enabled,
      loyalty_enabled: tenant.loyalty_enabled,
    };
  }

  async getUsage(tenantId: string) {
    const tenant = await this.tenantsRepository.findById(tenantId);
    if (!tenant) throw new NotFoundException('Tenant not found');

    const subscription = await this.tenantsRepository.getSubscription(tenantId);

    const [usersCount, branchesCount, invoicesThisMonth] = await Promise.all([
      this.tenantsRepository.countUsers(tenantId),
      this.tenantsRepository.countBranches(tenantId),
      this.tenantsRepository.countInvoicesThisMonth(tenantId),
    ]);

    return {
      users: {
        used: usersCount,
        limit: subscription?.max_users ?? null,
      },
      branches: {
        used: branchesCount,
        limit: subscription?.max_branches ?? null,
      },
      invoices_this_month: {
        used: invoicesThisMonth,
        limit: null,
      },
    };
  }
}