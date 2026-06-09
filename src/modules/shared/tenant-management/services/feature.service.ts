import { Injectable, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../../../shared/supabase/supabase.module';
import { TenantManagementRepository } from '../tenant-management.repository';

@Injectable()
export class FeatureService {
  constructor(
    private readonly repo: TenantManagementRepository,
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

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

  // H-028 FIX: aggregate features + plan defaults + tenant overrides
  async getTenantFeaturesWithOverrides(tenantId: string) {
    // 1. get all features
    const { data: allFeatures, error: featErr } = await this.supabase
      .from('features')
      .select('id, key, name, description, is_enabled');
    if (featErr) throw featErr;

    // 2. get tenant's active plan
    const { data: sub } = await this.supabase
      .from('subscriptions')
      .select('plan_id')
      .eq('tenant_id', tenantId)
      .in('status', ['active', 'trial'])
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const planId = sub?.plan_id ?? null;

    // 3. get plan features
    const planFeaturesMap = new Map<string, { is_enabled: boolean; limit_value: number | null }>();
    if (planId) {
      const { data: pf } = await this.supabase
        .from('plan_features')
        .select('feature_key, is_enabled, limit_value')
        .eq('plan_id', planId);
      (pf ?? []).forEach((f: any) =>
        planFeaturesMap.set(f.feature_key, {
          is_enabled: f.is_enabled,
          limit_value: f.limit_value,
        }),
      );
    }

    // 4. get tenant overrides
    const overridesMap = new Map<string, any>();
    const { data: overrides } = await this.supabase
      .from('tenant_feature_overrides')
      .select('*')
      .eq('tenant_id', tenantId);
    (overrides ?? []).forEach((o: any) => overridesMap.set(o.feature_key, o));

    // 5. aggregate
    return (allFeatures ?? []).map((feature: any) => {
      const planFeature = planFeaturesMap.get(feature.key);
      const override = overridesMap.get(feature.key) ?? null;

      const plan_default = planFeature?.is_enabled ?? feature.is_enabled;
      const plan_limit = planFeature?.limit_value ?? null;

      const effective_enabled =
        override?.is_enabled !== null && override?.is_enabled !== undefined
          ? override.is_enabled
          : plan_default;

      const effective_limit =
        override?.limit_value !== null && override?.limit_value !== undefined
          ? override.limit_value
          : plan_limit;

      return {
        id: feature.id,
        key: feature.key,
        name: feature.name,
        description: feature.description ?? null,
        is_enabled: feature.is_enabled,
        plan_default,
        plan_limit,
        tenant_override: override,
        effective_enabled,
        effective_limit,
      };
    });
  }
}