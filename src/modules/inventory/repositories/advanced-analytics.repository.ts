import { Injectable } from '@nestjs/common';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';
import { SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class AdvancedAnalyticsRepository extends ScopedRepository {
  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  async valuationReport(tenantId: string, warehouseId?: string) {
    const { data, error } = await this.supabase.rpc('fn_inventory_valuation_report', {
      p_tenant_id: tenantId,
      p_warehouse_id: warehouseId ?? null,
    });
    if (error) throw error;
    return data;
  }

  async turnoverReport(tenantId: string, dateFrom: string, dateTo: string, warehouseId?: string) {
    const { data, error } = await this.supabase.rpc('fn_inventory_turnover_report', {
      p_tenant_id: tenantId,
      p_warehouse_id: warehouseId ?? null,
      p_date_from: dateFrom,
      p_date_to: dateTo,
    });
    if (error) throw error;
    return data;
  }

  async agingReport(tenantId: string, warehouseId?: string) {
    const { data, error } = await this.supabase.rpc('fn_inventory_aging_report', {
      p_tenant_id: tenantId,
      p_warehouse_id: warehouseId ?? null,
    });
    if (error) throw error;
    return data;
  }

  async abcAnalysis(tenantId: string, dateFrom: string, dateTo: string, warehouseId?: string) {
    const { data, error } = await this.supabase.rpc('fn_inventory_abc_analysis', {
      p_tenant_id: tenantId,
      p_date_from: dateFrom,
      p_date_to: dateTo,
      p_warehouse_id: warehouseId ?? null,
    });
    if (error) throw error;
    return data;
  }

  async deadStockReport(tenantId: string, lookbackDays?: number, warehouseId?: string) {
    const { data, error } = await this.supabase.rpc('fn_inventory_dead_stock_report', {
      p_tenant_id: tenantId,
      p_lookback_days: lookbackDays ?? 90,
      p_warehouse_id: warehouseId ?? null,
    });
    if (error) throw error;
    return data;
  }

  async slowMovingReport(tenantId: string, lookbackDays?: number, maxUnitsSold?: number, warehouseId?: string) {
    const { data, error } = await this.supabase.rpc('fn_inventory_slow_moving_report', {
      p_tenant_id: tenantId,
      p_lookback_days: lookbackDays ?? 90,
      p_max_units_sold: maxUnitsSold ?? 5,
      p_warehouse_id: warehouseId ?? null,
    });
    if (error) throw error;
    return data;
  }

  async overstockReport(tenantId: string, warehouseId?: string) {
    const { data, error } = await this.supabase.rpc('fn_inventory_overstock_report', {
      p_tenant_id: tenantId,
      p_warehouse_id: warehouseId ?? null,
    });
    if (error) throw error;
    return data;
  }

  async stockAccuracyReport(tenantId: string, dateFrom: string, dateTo: string, warehouseId?: string) {
    const { data, error } = await this.supabase.rpc('fn_inventory_stock_accuracy_report', {
      p_tenant_id: tenantId,
      p_date_from: dateFrom,
      p_date_to: dateTo,
      p_warehouse_id: warehouseId ?? null,
    });
    if (error) throw error;
    return data;
  }

  async coverageReport(tenantId: string, warehouseId?: string) {
    const { data, error } = await this.supabase.rpc('fn_inventory_coverage_report', {
      p_tenant_id: tenantId,
      p_warehouse_id: warehouseId ?? null,
    });
    if (error) throw error;
    return data;
  }
}
