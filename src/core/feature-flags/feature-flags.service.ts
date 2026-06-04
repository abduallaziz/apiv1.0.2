import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';

@Injectable()
export class FeatureFlagsService {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async resolveFeature(tenantId: string, featureKey: string): Promise<boolean> {
    const { data: override } = await this.supabase
      .from('tenant_feature_overrides')
      .select('is_enabled')
      .eq('tenant_id', tenantId)
      .eq('feature_key', featureKey)
      .maybeSingle();

    if (override !== null && override.is_enabled !== null) {
      return override.is_enabled;
    }

    const { data: tenant } = await this.supabase
      .from('tenants')
      .select('subscriptions(plan_id)')
      .eq('id', tenantId)
      .maybeSingle();

    const planId = (tenant?.subscriptions as any)?.[0]?.plan_id;

    if (planId) {
      const { data: planFeature } = await this.supabase
        .from('plan_features')
        .select('is_enabled')
        .eq('plan_id', planId)
        .eq('feature_key', featureKey)
        .maybeSingle();

      if (planFeature !== null) {
        return planFeature.is_enabled;
      }
    }

    const { data: feature } = await this.supabase
      .from('features')
      .select('is_enabled')
      .eq('key', featureKey)
      .maybeSingle();

    return feature?.is_enabled ?? false;
  }

  async getFeatureLimitValue(tenantId: string, featureKey: string): Promise<number | null> {
    const { data: override } = await this.supabase
      .from('tenant_feature_overrides')
      .select('limit_value')
      .eq('tenant_id', tenantId)
      .eq('feature_key', featureKey)
      .maybeSingle();

    if (override?.limit_value !== undefined && override.limit_value !== null) {
      return override.limit_value;
    }

    const { data: tenant } = await this.supabase
      .from('tenants')
      .select('subscriptions(plan_id)')
      .eq('id', tenantId)
      .maybeSingle();

    const planId = (tenant?.subscriptions as any)?.[0]?.plan_id;

    if (planId) {
      const { data: planFeature } = await this.supabase
        .from('plan_features')
        .select('limit_value')
        .eq('plan_id', planId)
        .eq('feature_key', featureKey)
        .maybeSingle();

      if (planFeature?.limit_value !== null) {
        return planFeature?.limit_value ?? null;
      }
    }

    return null;
  }
}