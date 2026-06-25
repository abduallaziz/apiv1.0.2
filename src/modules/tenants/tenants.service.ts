import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantsRepository } from './repositories/tenants.repository';
import { UpdateTenantProfileDto } from './dto/update-tenant-profile.dto';

@Injectable()
export class TenantsService {
  constructor(private readonly tenantsRepository: TenantsRepository) {}

  async getProfile(tenantId: string) {
    const tenant = await this.tenantsRepository.findById(tenantId);
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  async updateProfile(tenantId: string, dto: UpdateTenantProfileDto) {
    const tenant = await this.tenantsRepository.findById(tenantId);
    if (!tenant) throw new NotFoundException('Tenant not found');
    return this.tenantsRepository.updateProfile(tenantId, dto);
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