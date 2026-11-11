import { Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';

// Inventory #7 / 7-8 (Owner-approved) — Operational Visibility. Thin RPC
// wrappers over migration 244's STABLE aggregate functions, matching the
// existing AnalyticsRepository convention (dashboardSummary/warehouseSummary
// -> supabase.rpc('fn_...')).
@Injectable()
export class WmsDashboardRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async taskOverview(tenantId: string, warehouseId?: string) {
    const { data, error } = await this.supabase.rpc('fn_wms_task_overview', {
      p_tenant_id: tenantId,
      p_warehouse_id: warehouseId ?? null,
    });
    if (error) throw error;
    return data;
  }

  async pickListOverview(tenantId: string, warehouseId?: string) {
    const { data, error } = await this.supabase.rpc(
      'fn_wms_pick_list_overview',
      { p_tenant_id: tenantId, p_warehouse_id: warehouseId ?? null },
    );
    if (error) throw error;
    return data;
  }

  async waveOverview(tenantId: string, warehouseId?: string) {
    const { data, error } = await this.supabase.rpc('fn_wms_wave_overview', {
      p_tenant_id: tenantId,
      p_warehouse_id: warehouseId ?? null,
    });
    if (error) throw error;
    return data;
  }

  async shipmentOverview(tenantId: string, warehouseId?: string) {
    const { data, error } = await this.supabase.rpc(
      'fn_wms_shipment_overview',
      { p_tenant_id: tenantId, p_warehouse_id: warehouseId ?? null },
    );
    if (error) throw error;
    return data;
  }

  async exceptionOverview(
    tenantId: string,
    warehouseId?: string,
    dateFrom?: string,
    dateTo?: string,
  ) {
    const { data, error } = await this.supabase.rpc(
      'fn_wms_exception_overview',
      {
        p_tenant_id: tenantId,
        p_warehouse_id: warehouseId ?? null,
        p_date_from: dateFrom ?? null,
        p_date_to: dateTo ?? null,
      },
    );
    if (error) throw error;
    return data;
  }

  async reservationOverview(tenantId: string, warehouseId?: string) {
    const { data, error } = await this.supabase.rpc(
      'fn_wms_reservation_overview',
      { p_tenant_id: tenantId, p_warehouse_id: warehouseId ?? null },
    );
    if (error) throw error;
    return data;
  }

  async waveShipmentSummary(waveId: string, tenantId: string) {
    const { data, error } = await this.supabase.rpc(
      'fn_wms_wave_shipment_summary',
      { p_wave_id: waveId, p_tenant_id: tenantId },
    );
    if (error) throw error;
    return data;
  }

  async cycleTimeOverview(
    tenantId: string,
    entityType: 'warehouse_task' | 'pick_list' | 'wave',
    warehouseId?: string,
  ) {
    const { data, error } = await this.supabase.rpc(
      'fn_wms_cycle_time_overview',
      {
        p_tenant_id: tenantId,
        p_entity_type: entityType,
        p_warehouse_id: warehouseId ?? null,
      },
    );
    if (error) throw error;
    return data;
  }

  // Drill-down: paginated exceptions with affected-entity context.
  // Inventory #7 / F17 (Owner-approved) — standardized from offset-based
  // to the page-based contract every other WMS list endpoint now uses
  // (page, limit, sortBy, sortOrder); had zero real frontend consumers
  // at the time of the change, so no offset-based caller needed
  // preserving.
  async listExceptionsDrillDown(
    tenantId: string,
    filters: {
      warehouseId?: string;
      exceptionType?: string;
      entityType?: string;
      dateFrom?: string;
      dateTo?: string;
      page?: number;
      limit?: number;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
    },
  ) {
    const limit = Math.min(filters.limit ?? 50, 200);
    const page = filters.page ?? 1;
    const offset = (page - 1) * limit;
    const sortBy = filters.sortBy ?? 'created_at';
    const sortOrder = filters.sortOrder ?? 'desc';

    let query = this.supabase
      .from('warehouse_exceptions')
      .select('*', { count: 'exact' })
      .eq('tenant_id', tenantId)
      .order(sortBy, { ascending: sortOrder === 'asc' })
      .order('id', { ascending: true })
      .range(offset, offset + limit - 1);

    if (filters.exceptionType)
      query = query.eq('exception_type', filters.exceptionType);
    if (filters.entityType) query = query.eq('entity_type', filters.entityType);
    if (filters.dateFrom) query = query.gte('created_at', filters.dateFrom);
    if (filters.dateTo) query = query.lt('created_at', filters.dateTo);

    // warehouse_id filter: warehouse_exceptions carries no warehouse_id
    // column itself. Exceptions exist against two entity_types that
    // resolve to a warehouse — 'shipment_line' (via shipment_lines ->
    // shipments) and 'shipment' directly (fn_cancel_shipment writes
    // entity_type='shipment') — both must be resolved and applied as a
    // real DB-level filter (not a post-fetch row filter), otherwise
    // .range()/count go stale and a warehouse-scoped page can silently
    // return fewer rows than actually match. Matches the same resolution
    // fn_wms_exception_overview (migration 245) uses.
    if (filters.warehouseId) {
      const [{ data: lines }, { data: ships }] = await Promise.all([
        this.supabase
          .from('shipment_lines')
          .select('id, shipments!inner(warehouse_id)')
          .eq('shipments.warehouse_id', filters.warehouseId),
        this.supabase
          .from('shipments')
          .select('id')
          .eq('warehouse_id', filters.warehouseId),
      ]);
      const lineIds = (lines ?? []).map((l: any) => l.id as string);
      const shipmentIds = (ships ?? []).map((s: any) => s.id as string);
      const orParts = [`entity_type.not.in.(shipment_line,shipment)`];
      orParts.push(
        `and(entity_type.eq.shipment_line,entity_id.in.(${lineIds.length ? lineIds.join(',') : '00000000-0000-0000-0000-000000000000'}))`,
      );
      orParts.push(
        `and(entity_type.eq.shipment,entity_id.in.(${shipmentIds.length ? shipmentIds.join(',') : '00000000-0000-0000-0000-000000000000'}))`,
      );
      query = query.or(orParts.join(','));
    }

    const { data, error, count } = await query;
    if (error) throw error;

    return { data: data ?? [], total: count ?? 0, page, perPage: limit };
  }
}
