import { Injectable } from '@nestjs/common';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';
import { SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class MrpRepository extends ScopedRepository {
  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  async runMrp(tenantId: string, warehouseId: string): Promise<string> {
    const { data, error } = await this.supabase.rpc('fn_run_mrp', {
      p_tenant_id: tenantId,
      p_warehouse_id: warehouseId,
    });
    if (error) throw error;
    return data as string;
  }

  async findPlannedOrders(
    tenantId: string,
    status?: string,
    orderType?: string,
  ) {
    let query = this.supabase
      .from('planned_orders')
      .select('*, items(name), bill_of_materials(id, item_id)')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });
    if (status) query = query.eq('status', status);
    if (orderType) query = query.eq('order_type', orderType);
    const { data, error } = await query;
    if (error) throw error;
    return data;
  }

  async findPlannedOrderById(id: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('planned_orders')
      .select('*, items(name)')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async updateStatus(
    id: string,
    tenantId: string,
    status: string,
    converted?: { referenceType: string; referenceId: string },
  ) {
    const { data, error } = await this.supabase
      .from('planned_orders')
      .update({
        status,
        updated_at: new Date().toISOString(),
        ...(converted
          ? {
              converted_reference_type: converted.referenceType,
              converted_reference_id: converted.referenceId,
            }
          : {}),
      })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }
}
