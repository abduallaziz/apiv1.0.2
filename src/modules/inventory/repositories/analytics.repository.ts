import { Injectable } from '@nestjs/common';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';
import { SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class AnalyticsRepository extends ScopedRepository {
  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  async dashboardSummary(tenantId: string) {
    const { data, error } = await this.supabase.rpc('fn_inventory_dashboard_summary', {
      p_tenant_id: tenantId,
    });
    if (error) throw error;
    return data;
  }

  async warehouseSummary(tenantId: string) {
    const { data, error } = await this.supabase.rpc('fn_inventory_warehouse_summary', {
      p_tenant_id: tenantId,
    });
    if (error) throw error;
    return data;
  }

  async recentMovements(tenantId: string, limit = 10) {
    const { data, error } = await this.supabase
      .from('stock_movements')
      .select('*, items(name, sku), item_variants(name, sku), warehouses(name, code)')
      .eq('tenant_id', tenantId)
      .order('occurred_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data;
  }

  async lowStockList(tenantId: string, limit = 10) {
    const { data, error } = await this.supabase.rpc('fn_inventory_low_stock_list', {
      p_tenant_id: tenantId,
      p_limit: limit,
    });
    if (error) throw error;
    return data;
  }

  async purchaseOrdersWaitingReceipt(tenantId: string, limit = 10) {
    const { data, error } = await this.supabase
      .from('purchase_orders')
      .select('id, order_number, status, expected_date, suppliers(name), warehouses(name)')
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .in('status', ['submitted', 'approved', 'partially_received'])
      .order('expected_date', { ascending: true })
      .limit(limit);
    if (error) throw error;
    return data;
  }
}
