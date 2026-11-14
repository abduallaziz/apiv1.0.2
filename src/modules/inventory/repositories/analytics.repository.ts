import { Injectable } from '@nestjs/common';
import {
  branchWarehouseIds,
  currentBranchScope,
  inWarehouses,
} from '../../../core/branch-scope/branch-warehouse-scope';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';
import { SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class AnalyticsRepository extends ScopedRepository {
  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  async dashboardSummary(tenantId: string) {
    const ids = await branchWarehouseIds(tenantId);
    const { data, error } = ids
      ? await this.supabase.rpc('fn_inventory_dashboard_summary_scoped', {
          p_tenant_id: tenantId,
          p_warehouse_ids: ids,
        })
      : await this.supabase.rpc('fn_inventory_dashboard_summary', {
          p_tenant_id: tenantId,
        });
    if (error) throw error;
    return data;
  }

  async warehouseSummary(tenantId: string) {
    const { data, error } = await this.supabase.rpc(
      'fn_inventory_warehouse_summary',
      {
        p_tenant_id: tenantId,
      },
    );
    if (error) throw error;
    const scope = currentBranchScope(tenantId);
    if (scope && Array.isArray(data)) {
      const ids = new Set(await scope.warehouseIds());
      return data.filter((r: { warehouse_id: string }) =>
        ids.has(r.warehouse_id),
      );
    }
    return data;
  }

  async recentMovements(tenantId: string, limit = 10) {
    const { data, error } = await inWarehouses(
      this.supabase
        .from('stock_movements')
        .select(
          '*, items(name, sku), item_variants(name, sku), warehouses(name, code)',
        )
        .eq('tenant_id', tenantId),
      await branchWarehouseIds(tenantId),
    )
      .order('occurred_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data;
  }

  async lowStockList(tenantId: string, limit = 10) {
    const scope = currentBranchScope(tenantId);
    const { data, error } = await this.supabase.rpc(
      'fn_inventory_low_stock_list',
      {
        p_tenant_id: tenantId,
        p_limit: scope ? 1000 : limit,
      },
    );
    if (error) throw error;
    if (scope && Array.isArray(data)) {
      const ids = new Set(await scope.warehouseIds());
      return data
        .filter((r: { warehouse_id: string }) => ids.has(r.warehouse_id))
        .slice(0, limit);
    }
    return data;
  }

  async purchaseOrdersWaitingReceipt(tenantId: string, limit = 10) {
    const warehouseIds = await branchWarehouseIds(tenantId);
    let query = this.supabase
      .from('purchase_orders')
      .select(
        'id, order_number, status, expected_date, suppliers(name), warehouses(name)',
      )
      .eq('tenant_id', tenantId);
    // (not via inWarehouses<Q>: the generic makes nest build hit TS2589 on this joined select)
    if (warehouseIds) query = query.in('warehouse_id', warehouseIds);
    const { data, error } = await query
      .is('deleted_at', null)
      .in('status', ['submitted', 'approved', 'partially_received'])
      .order('expected_date', { ascending: true })
      .limit(limit);
    if (error) throw error;
    return data;
  }
}
