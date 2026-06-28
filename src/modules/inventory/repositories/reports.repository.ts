import { Injectable } from '@nestjs/common';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';
import { SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class ReportsRepository extends ScopedRepository {
  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  async purchaseOrdersSummary(tenantId: string) {
    const { data, error } = await this.supabase.rpc('fn_purchase_orders_summary', {
      p_tenant_id: tenantId,
    });
    if (error) throw error;
    return data;
  }

  async goodsReceiptsSummary(tenantId: string) {
    const { data, error } = await this.supabase.rpc('fn_goods_receipts_summary', {
      p_tenant_id: tenantId,
    });
    if (error) throw error;
    return data;
  }

  async adjustmentsSummary(tenantId: string) {
    const { data, error } = await this.supabase.rpc('fn_adjustments_summary', {
      p_tenant_id: tenantId,
    });
    if (error) throw error;
    return data;
  }

  async transfersSummary(tenantId: string) {
    const { data, error } = await this.supabase.rpc('fn_transfers_summary', {
      p_tenant_id: tenantId,
    });
    if (error) throw error;
    return data;
  }

  async stockCountsVarianceSummary(tenantId: string) {
    const { data, error } = await this.supabase.rpc('fn_stock_counts_variance_summary', {
      p_tenant_id: tenantId,
    });
    if (error) throw error;
    return data;
  }

  async warehouseValuation(tenantId: string) {
    const { data, error } = await this.supabase.rpc('fn_inventory_warehouse_summary', {
      p_tenant_id: tenantId,
    });
    if (error) throw error;
    return data;
  }

  async lowStockBelowReorder(tenantId: string) {
    const { data, error } = await this.supabase.rpc('fn_items_below_reorder_point', {
      p_tenant_id: tenantId,
    });
    if (error) throw error;
    return data;
  }
}
