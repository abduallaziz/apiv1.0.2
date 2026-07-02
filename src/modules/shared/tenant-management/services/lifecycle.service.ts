import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantManagementRepository } from '../tenant-management.repository';

@Injectable()
export class LifecycleService {
  constructor(private readonly repo: TenantManagementRepository) {}

  async activate(tenantId: string) {
    await this.assertExists(tenantId);
    return this.repo.updateStatus(tenantId, 'active');
  }

  async deactivate(tenantId: string) {
    await this.assertExists(tenantId);
    return this.repo.updateStatus(tenantId, 'suspended');
  }

  async extendTrial(tenantId: string, days: number) {
    await this.assertExists(tenantId);
    const [tenant, subscription] = await Promise.all([
      this.repo.updateStatus(tenantId, 'trial'),
      this.repo.extendTrial(tenantId, days),
    ]);
    return { tenant, subscription };
  }

  async softDelete(tenantId: string) {
    await this.assertExists(tenantId);
    return this.repo.softDelete(tenantId);
  }

  private async assertExists(tenantId: string) {
    const tenant = await this.repo.findById(tenantId);
    if (!tenant) throw new NotFoundException(`Tenant ${tenantId} not found`);
    return tenant;
  }
}