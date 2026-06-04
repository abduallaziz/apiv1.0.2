import { Injectable } from '@nestjs/common';
import { TenantManagementRepository } from '../tenant-management.repository';

@Injectable()
export class FeatureService {
  constructor(private readonly repo: TenantManagementRepository) {}

  async getFeatureOverrides(tenantId: string) {
    return this.repo.getFeatureOverrides(tenantId);
  }

  async upsertFeatureOverride(params: {
    tenantId: string;
    featureKey: string;
    isEnabled: boolean;
    limitValue?: number;
    overriddenBy: string;
    note?: string;
  }) {
    return this.repo.upsertFeatureOverride(params);
  }
}