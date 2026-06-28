import { Injectable } from '@nestjs/common';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';
import { SupabaseClient } from '@supabase/supabase-js';

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

@Injectable()
export class StockRepository extends ScopedRepository {
  constructor(supabase: SupabaseClient) {
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
}
