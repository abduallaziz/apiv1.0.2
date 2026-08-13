import { Injectable } from '@nestjs/common';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';
import { SupabaseClient } from '@supabase/supabase-js';
import { TenantContext } from '../../../core/tenant/tenant.context';
import { PaginationDto } from '../../../shared/dto/pagination.dto';
import { QueryItemsDto, ITEM_SORT_COLUMNS } from '../dto/query-items.dto';

@Injectable()
export class ItemsRepository extends ScopedRepository {
  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  private ctx(tenantId: string): TenantContext {
    return { tenantId } as TenantContext;
  }

  private flattenItem(item: any) {
    const { categories, item_variants, ...rest } = item;
    return {
      ...rest,
      category_id: categories?.id ?? null,
      category_name: categories?.name ?? null,
      category_type: categories?.type ?? null,
      variants_count: item_variants?.length ?? 0,
    };
  }

  async findAll(
    tenantId: string,
    pagination: PaginationDto = new PaginationDto(),
    query: QueryItemsDto = new QueryItemsDto(),
  ): Promise<{ data: unknown[]; total: number }> {
    const [from, to] = pagination.range;
    // Built directly from .from() (not scopedQuery) — chaining a second
    // .select() onto an already-.select()'d query loses the 2-arg
    // (columns, { count }) overload used below.
    let q = this.supabase
      .from('items')
      .select(
        `id, name, type, operation_type, price, has_inventory, has_variants, is_active, created_at, sku,
         categories(id, name, type),
         item_variants(id)`,
        { count: 'exact' },
      )
      .is('deleted_at', null)
      .eq('tenant_id', tenantId);

    // Tri-state, default 'true' — matches the previously-hardcoded
    // .eq('is_active', true), so a caller sending nothing keeps the exact
    // same behaviour as before this filter existed.
    if (query.is_active === 'true' || query.is_active === undefined) {
      q = q.eq('is_active', true);
    } else if (query.is_active === 'false') {
      q = q.eq('is_active', false);
    } // 'all' → no filter

    if (query.search) q = q.ilike('name', `%${query.search}%`);
    if (query.type) q = q.eq('type', query.type);
    if (query.category_id) q = q.eq('category_id', query.category_id);

    // Whitelist enforced at the DTO layer (@IsIn(ITEM_SORT_COLUMNS)) — this
    // check is a second, defense-in-depth gate so a raw column string can
    // never reach .order() even if the DTO validation were ever bypassed.
    const sort = ITEM_SORT_COLUMNS.includes(query.sort) ? query.sort : 'name';
    const ascending = query.dir !== 'desc';

    const { data, error, count } = await q
      .order(sort, { ascending })
      .range(from, to);
    if (error) throw error;
    return {
      data: (data ?? []).map(this.flattenItem.bind(this)),
      total: count ?? 0,
    };
  }

  // Tenant-wide counts for the KPI cards — deliberately independent of the
  // paginated list's filters (a caller viewing a filtered/paged view should
  // still see the true tenant totals, not counts scoped to the current page).
  async getStats(tenantId: string) {
    const base = () =>
      this.supabase
        .from('items')
        .select('id', { count: 'exact', head: true })
        .is('deleted_at', null)
        .eq('tenant_id', tenantId);

    const [
      { count: total, error: totalErr },
      { count: active, error: activeErr },
      { count: withVariants, error: variantsErr },
    ] = await Promise.all([
      base(),
      base().eq('is_active', true),
      base().eq('has_variants', true),
    ]);
    if (totalErr) throw totalErr;
    if (activeErr) throw activeErr;
    if (variantsErr) throw variantsErr;

    return {
      total: total ?? 0,
      active: active ?? 0,
      withVariants: withVariants ?? 0,
    };
  }

  async findById(id: string, tenantId: string) {
    const { data, error } = await this.scopedQuery('items', this.ctx(tenantId))
      .select(
        `id, name, type, operation_type, price, has_inventory, has_variants, is_active, created_at, sku, sku_source,
         costing_method, standard_cost,
         categories(id, name, type),
         item_variants(id, name, price_adjustment, sku, stock_quantity, is_active)`,
      )
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data ? this.flattenItem(data) : null;
  }

  // Live sum across every warehouse — stock_levels is the real source of
  // truth (see item.types.ts on the web side); items.stock_quantity itself
  // is a frozen legacy column no longer written to by Goods Receipts/
  // Adjustments/Counts. variant_id IS NULL isolates the parent item's own
  // rows from any per-variant stock_levels rows for the same item.
  async sumStockAcrossWarehouses(
    tenantId: string,
    itemId: string,
  ): Promise<number> {
    const { data, error } = await this.supabase
      .from('stock_levels')
      .select('quantity_on_hand')
      .eq('tenant_id', tenantId)
      .eq('item_id', itemId)
      .is('variant_id', null);
    if (error) throw error;
    return (data ?? []).reduce(
      (sum, row) => sum + Number(row.quantity_on_hand),
      0,
    );
  }

  // Atomic per-tenant sequence backing auto-generated product SKUs — see
  // migration 139. Same UPSERT...RETURNING pattern as
  // item-barcodes.repository.ts#nextSequence (concurrency-safe under
  // Postgres row locking), but a fully separate sequence table — SKU and
  // barcode are independent identity systems.
  async nextSkuSequence(tenantId: string): Promise<number> {
    const { data, error } = await this.supabase.rpc('fn_next_sku_seq', {
      p_tenant_id: tenantId,
    });
    if (error) throw error;
    return data as number;
  }

  // Per-(tenant, item) sequence backing auto-generated variant SKU suffixes
  // (parent-01, parent-02, ...) — migration 139.
  async nextVariantSkuSequence(
    tenantId: string,
    itemId: string,
  ): Promise<number> {
    const { data, error } = await this.supabase.rpc('fn_next_variant_sku_seq', {
      p_tenant_id: tenantId,
      p_item_id: itemId,
    });
    if (error) throw error;
    return data as number;
  }

  async create(tenantId: string, payload: Record<string, unknown>) {
    const { data, error } = await this.supabase
      .from('items')
      .insert({ ...payload, tenant_id: tenantId, is_active: true })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async update(id: string, tenantId: string, payload: Record<string, unknown>) {
    const { data, error } = await this.supabase
      .from('items')
      .update(payload)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async softDelete(id: string, tenantId: string) {
    const { error } = await this.supabase
      .from('items')
      .update({ deleted_at: new Date().toISOString(), is_active: false })
      .eq('id', id)
      .eq('tenant_id', tenantId);
    if (error) throw error;
  }

  async findVariants(itemId: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('item_variants')
      .select('id, name, price_adjustment, sku, stock_quantity, is_active')
      .eq('item_id', itemId)
      .eq('tenant_id', tenantId)
      .eq('is_active', true);
    if (error) throw error;
    return data;
  }

  async createVariant(
    itemId: string,
    tenantId: string,
    payload: Record<string, unknown>,
  ) {
    const { data, error } = await this.supabase
      .from('item_variants')
      .insert({
        ...payload,
        item_id: itemId,
        tenant_id: tenantId,
        is_active: true,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async updateVariant(
    variantId: string,
    itemId: string,
    tenantId: string,
    payload: Record<string, unknown>,
  ) {
    const { data, error } = await this.supabase
      .from('item_variants')
      .update(payload)
      .eq('id', variantId)
      .eq('item_id', itemId)
      .eq('tenant_id', tenantId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async softDeleteVariant(variantId: string, itemId: string, tenantId: string) {
    const { error } = await this.supabase
      .from('item_variants')
      .update({ is_active: false })
      .eq('id', variantId)
      .eq('item_id', itemId)
      .eq('tenant_id', tenantId);
    if (error) throw error;
  }
}
