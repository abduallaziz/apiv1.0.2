import { Injectable } from '@nestjs/common';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';
import { SupabaseClient } from '@supabase/supabase-js';
import { TenantContext } from '../../../core/tenant/tenant-context';
import { TenantSessionService } from '../../../core/tenant/tenant-session.service';

export interface StockLevelFilter {
  warehouseId?: string;
  itemId?: string;
  variantId?: string;
}

export interface StockLevelEnrichedFilter {
  warehouseId?: string;
  itemId?: string;
  categoryId?: string;
  locationId?: string;
  batchId?: string;
  supplierId?: string;
  status?: string;
}

export interface MovementsLedgerFilter {
  warehouseId?: string;
  itemId?: string;
  movementType?: string;
  referenceType?: string;
  referenceId?: string;
  createdBy?: string;
  dateFrom?: string;
  dateTo?: string;
}

@Injectable()
export class StockRepository extends ScopedRepository {
  constructor(
    supabase: SupabaseClient,
    private readonly tenantSession: TenantSessionService,
  ) {
    super(supabase);
  }

  async findLevels(tenantId: string, filter: StockLevelFilter) {
    let query = this.supabase
      .from('stock_levels')
      .select('*, items(name, sku), item_variants(name, sku), warehouses(name, code)')
      .eq('tenant_id', tenantId);

    if (filter.warehouseId) query = query.eq('warehouse_id', filter.warehouseId);
    if (filter.itemId) query = query.eq('item_id', filter.itemId);
    if (filter.variantId) query = query.eq('variant_id', filter.variantId);

    const { data, error } = await query.order('updated_at', { ascending: false });
    if (error) throw error;
    return data;
  }

  // Deliberately no cache layer — ATP directly gates checkout/backorder
  // decisions, a stale read here could let a cashier oversell against a
  // number that's already wrong.
  async findAtp(
    tenantId: string,
    warehouseId: string,
    itemId: string,
    variantId?: string,
  ) {
    let query = this.supabase
      .from('v_stock_balance')
      .select('quantity_on_hand, quantity_reserved, quantity_damaged, quantity_expired, quantity_backorder, quantity_available, quantity_incoming, quantity_atp')
      .eq('tenant_id', tenantId)
      .eq('warehouse_id', warehouseId)
      .eq('item_id', itemId);

    query = variantId ? query.eq('variant_id', variantId) : query.is('variant_id', null);

    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    return (
      data ?? {
        quantity_on_hand: 0,
        quantity_reserved: 0,
        quantity_damaged: 0,
        quantity_expired: 0,
        quantity_backorder: 0,
        quantity_available: 0,
        quantity_incoming: 0,
        quantity_atp: 0,
      }
    );
  }

  async findLevelsEnriched(tenantId: string, filter: StockLevelEnrichedFilter) {
    const { data, error } = await this.supabase.rpc('fn_inventory_stock_levels_enriched', {
      p_tenant_id: tenantId,
      p_warehouse_id: filter.warehouseId ?? null,
      p_item_id: filter.itemId ?? null,
      p_category_id: filter.categoryId ?? null,
      p_location_id: filter.locationId ?? null,
      p_batch_id: filter.batchId ?? null,
      p_supplier_id: filter.supplierId ?? null,
      p_status: filter.status ?? null,
    });
    if (error) throw error;
    return data;
  }

  async findMovementsLedger(
    tenantId: string,
    filter: MovementsLedgerFilter,
    page: number,
    perPage: number,
  ) {
    const { data, error } = await this.supabase.rpc('fn_inventory_movements_ledger', {
      p_tenant_id: tenantId,
      p_warehouse_id: filter.warehouseId ?? null,
      p_item_id: filter.itemId ?? null,
      p_movement_type: filter.movementType ?? null,
      p_reference_type: filter.referenceType ?? null,
      p_reference_id: filter.referenceId ?? null,
      p_created_by: filter.createdBy ?? null,
      p_date_from: filter.dateFrom ?? null,
      p_date_to: filter.dateTo ?? null,
      p_limit: perPage,
      p_offset: (page - 1) * perPage,
    });
    if (error) throw error;
    const total = data && data.length > 0 ? Number(data[0].total_count) : 0;
    return { data: data ?? [], total, page, perPage };
  }

  async findMovements(
    tenantId: string,
    filter: StockLevelFilter & { referenceType?: string; referenceId?: string },
    page: number,
    perPage: number,
  ) {
    let query = this.supabase
      .from('stock_movements')
      .select('*, items(name, sku), warehouses(name, code)', { count: 'exact' })
      .eq('tenant_id', tenantId);

    if (filter.warehouseId) query = query.eq('warehouse_id', filter.warehouseId);
    if (filter.itemId) query = query.eq('item_id', filter.itemId);
    if (filter.variantId) query = query.eq('variant_id', filter.variantId);
    if (filter.referenceType) query = query.eq('reference_type', filter.referenceType);
    if (filter.referenceId) query = query.eq('reference_id', filter.referenceId);

    const from = (page - 1) * perPage;
    const { data, error, count } = await query
      .order('occurred_at', { ascending: false })
      .range(from, from + perPage - 1);
    if (error) throw error;
    return { data, total: count ?? 0, page, perPage };
  }

  async callApplyStockMovement(params: {
    p_tenant_id: string;
    p_warehouse_id: string;
    p_location_id: string | null;
    p_item_id: string;
    p_variant_id: string | null;
    p_batch_id: string | null;
    p_movement_type: string;
    p_direction: 'in' | 'out';
    p_quantity: number;
    p_unit_cost: number;
    p_reference_type: string;
    p_reference_id: string | null;
    p_created_by: string | null;
  }) {
    const { data, error } = await this.supabase.rpc('fn_apply_stock_movement', params);
    if (error) throw error;
    return data;
  }

  /**
   * Pooled, RLS-enforceable equivalent of `callApplyStockMovement`. Unlike the
   * invoices hot path, `fn_apply_stock_movement` is already a single atomic
   * RPC — this migration is purely about making `stock_levels`/`stock_movements`
   * RLS binding (both `ENABLE ROW LEVEL SECURITY`'d since `017_inventory_ledger.sql`,
   * but with zero `CREATE POLICY` today — see `076_rls_policies_stock_tables.sql`)
   * for the connection actually running the write, via `SET LOCAL app.tenant_id`.
   * Gated behind `POOLED_STOCK_WRITES_ENABLED` in `StockService.applyStockMovement`
   * — default `false`, same safety pattern as `InvoicesRepository.createWithItemsPooled`.
   */
  async callApplyStockMovementPooled(params: {
    p_tenant_id: string;
    p_warehouse_id: string;
    p_location_id: string | null;
    p_item_id: string;
    p_variant_id: string | null;
    p_batch_id: string | null;
    p_movement_type: string;
    p_direction: 'in' | 'out';
    p_quantity: number;
    p_unit_cost: number;
    p_reference_type: string;
    p_reference_id: string | null;
    p_created_by: string | null;
  }) {
    const tenant = new TenantContext(params.p_tenant_id);
    return this.tenantSession.runInTenantContext(tenant, async (client) => {
      const result = await client.query(
        `SELECT * FROM fn_apply_stock_movement($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          params.p_tenant_id,
          params.p_warehouse_id,
          params.p_location_id,
          params.p_item_id,
          params.p_variant_id,
          params.p_batch_id,
          params.p_movement_type,
          params.p_direction,
          params.p_quantity,
          params.p_unit_cost,
          params.p_reference_type,
          params.p_reference_id,
          params.p_created_by,
        ],
      );
      return result.rows[0];
    });
  }
}
