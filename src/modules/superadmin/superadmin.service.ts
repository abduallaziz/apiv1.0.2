import { Injectable } from '@nestjs/common';
import { SuperAdminTenantsQueryDto } from './dto/superadmin-query.dto';
import { ExtendTrialDto } from './dto/superadmin-extend-trial.dto';
import { LifecycleService } from '../shared/tenant-management/services/lifecycle.service';
import { FeatureService } from '../shared/tenant-management/services/feature.service';
import { TenantManagementRepository } from '../shared/tenant-management/tenant-management.repository';
import { PlatformAnalyticsRepository } from '../shared/analytics/platform-analytics.repository';

@Injectable()
export class SuperAdminService {
  constructor(
    private readonly lifecycle: LifecycleService,
    private readonly featureSvc: FeatureService,
    private readonly tenantRepo: TenantManagementRepository,
    private readonly analyticsRepo: PlatformAnalyticsRepository,
  ) {}

  findAll(query: SuperAdminTenantsQueryDto) {
    return this.tenantRepo.findAll({
      page: Number(query.page ?? 1),
      limit: Number(query.limit ?? 20),
      search: query.search,
      status: query.status,
    });
  }

  async findOne(id: string) {
    const [tenant, stats, subscription] = await Promise.all([
      this.tenantRepo.findById(id),
      this.tenantRepo.getStats(id),
      this.tenantRepo.getSubscription(id),
    ]);
    return { ...tenant, stats, subscription };
  }

  getStats() {
    return this.analyticsRepo.getGlobalStats();
  }

  getRevenueReport(period: string) {
    const now = new Date();
    const from =
      period === 'month'
        ? new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
        : new Date(now.getFullYear(), 0, 1).toISOString();
    return this.analyticsRepo.getRevenueReport({ from, to: now.toISOString() });
  }

  activate(id: string, _actorId: string) {
    return this.lifecycle.activate(id);
  }

  deactivate(id: string, _actorId: string) {
    return this.lifecycle.deactivate(id);
  }

  extendTrial(id: string, dto: ExtendTrialDto, _actorId: string) {
    return this.lifecycle.extendTrial(id, dto.days);
  }

  softDelete(id: string, _actorId: string) {
    return this.lifecycle.softDelete(id);
  }

  getFeatureOverrides(tenantId: string) {
    return this.featureSvc.getFeatureOverrides(tenantId);
  }

  // H-028 FIX: aggregated features endpoint
  getTenantFeaturesWithOverrides(tenantId: string) {
    return this.featureSvc.getTenantFeaturesWithOverrides(tenantId);
  }

  upsertFeatureOverride(
    tenantId: string,
    featureKey: string,
    isEnabled: boolean | null,
    limitValue: number | null,
    actorId: string,
    note?: string,
  ) {
    return this.featureSvc.upsertFeatureOverride({
      tenantId,
      featureKey,
      isEnabled: isEnabled ?? false,
      limitValue: limitValue ?? undefined,
      overriddenBy: actorId,
      note,
    });
  }
  getAllFeatures() {
  return this.featureSvc.getAllFeatures();
}
}