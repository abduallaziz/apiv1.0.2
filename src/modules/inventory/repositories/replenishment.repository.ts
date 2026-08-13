import { Injectable } from '@nestjs/common';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';
import { SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class ReplenishmentRepository extends ScopedRepository {
  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  async findAllRules(tenantId: string) {
    const { data, error } = await this.supabase
      .from('warehouse_replenishment_rules')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  }

  async createRule(tenantId: string, payload: Record<string, unknown>) {
    const { data, error } = await this.supabase
      .from('warehouse_replenishment_rules')
      .insert({ ...payload, tenant_id: tenantId })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async runCheck(tenantId: string, warehouseId: string, createdBy: string | null) {
    const { data, error } = await this.supabase.rpc('fn_run_replenishment_check', {
      p_tenant_id: tenantId, p_warehouse_id: warehouseId, p_created_by: createdBy,
    });
    if (error) throw error;
    return data;
  }
}
