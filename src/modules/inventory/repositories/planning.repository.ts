import { Injectable } from '@nestjs/common';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';
import { SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class PlanningRepository extends ScopedRepository {
  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  async calculateDemandForecast(
    tenantId: string,
    warehouseId: string,
    itemId: string,
    variantId?: string,
    lookbackDays?: number,
  ) {
    const { data, error } = await this.supabase.rpc('fn_calculate_demand_forecast', {
      p_tenant_id: tenantId,
      p_warehouse_id: warehouseId,
      p_item_id: itemId,
      p_variant_id: variantId ?? null,
      p_lookback_days: lookbackDays ?? 30,
    });
    if (error) throw error;
    return data;
  }

  async purchaseSuggestions(tenantId: string) {
    const { data, error } = await this.supabase.rpc('fn_purchase_suggestions', {
      p_tenant_id: tenantId,
    });
    if (error) throw error;
    return data;
  }
}
