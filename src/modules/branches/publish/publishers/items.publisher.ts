import { RedisCacheService } from '../../../../core/cache/redis-cache.service';
import {
  EntityPublisher,
  PublishContext,
  PublishRow,
} from '../branch-publish.types';
import { escapeLike, pickColumns } from './simple.publisher';

const ITEM_COLUMNS = [
  'name',
  'description',
  'type',
  'operation_type',
  'price',
  'cost_price',
  'has_inventory',
  'has_variants',
  'is_active',
  'sku',
  'image_url',
  'costing_method',
  'track_batches',
  'track_serial',
  'track_expiration',
  'standard_cost',
  'purchase_unit_factor',
  'sale_unit_factor',
  'sku_source',
];

/** Source lookup tables an item points to, mapped to the target branch's equivalent BY NAME. */
const LOOKUPS: { column: string; table: 'categories' | 'units' }[] = [
  { column: 'category_id', table: 'categories' },
  { column: 'storage_unit_id', table: 'units' },
  { column: 'purchase_unit_id', table: 'units' },
  { column: 'sale_unit_id', table: 'units' },
];

type Db = PublishContext['db'];

/**
 * Finds the target branch's category/unit with the same name (case-insensitive) or creates it.
 * Never fails on a name collision: an existing row is simply reused.
 */
export async function mapLookupByName(
  ctx: PublishContext,
  table: 'categories' | 'units' | 'brands',
  sourceId: string | null,
  targetBranchId: string,
  memo: Map<string, string | null>,
): Promise<string | null> {
  if (!sourceId) return null;
  const key = `${table}:${sourceId}:${targetBranchId}`;
  if (memo.has(key)) return memo.get(key) ?? null;
  const db: Db = ctx.db;
  const { data: src, error: srcErr } = await db
    .from(table)
    .select('*')
    .eq('tenant_id', ctx.tenantId)
    .eq('id', sourceId)
    .maybeSingle();
  if (srcErr) throw srcErr;
  if (!src) {
    memo.set(key, null);
    return null;
  }
  const { data: hit, error: hitErr } = await db
    .from(table)
    .select('id')
    .eq('tenant_id', ctx.tenantId)
    .eq('branch_id', targetBranchId)
    .is('deleted_at', null)
    .ilike('name', escapeLike(String(src.name)))
    .limit(1);
  if (hitErr) throw hitErr;
  let id = (hit?.[0] as { id: string } | undefined)?.id ?? null;
  if (!id) {
    const extra =
      table === 'categories'
        ? { type: src.type ?? null }
        : table === 'units'
          ? { symbol: src.symbol ?? null }
          : {};
    const { data: created, error } = await db
      .from(table)
      .insert({
        ...extra,
        name: src.name,
        is_active: src.is_active ?? true,
        tenant_id: ctx.tenantId,
        branch_id: targetBranchId,
      })
      .select('id')
      .single();
    if (error) throw error;
    id = (created as { id: string }).id;
  }
  memo.set(key, id);
  return id;
}

async function itemColumns(
  ctx: PublishContext,
  row: PublishRow,
  targetBranchId: string,
): Promise<Record<string, unknown>> {
  const memo = new Map<string, string | null>();
  const out = pickColumns(row, ITEM_COLUMNS);
  for (const l of LOOKUPS) {
    out[l.column] = await mapLookupByName(
      ctx,
      l.table,
      (row[l.column] as string | null) ?? null,
      targetBranchId,
      memo,
    );
  }
  return out;
}

/** Variants and barcodes of the source item: create what the target item lacks (matched by sku / name / barcode). */
async function syncChildren(
  ctx: PublishContext,
  sourceItemId: string,
  targetItemId: string,
  targetBranchId: string,
  update: boolean,
): Promise<void> {
  const db = ctx.db;
  const { data: sVars, error: svErr } = await db
    .from('item_variants')
    .select('*')
    .eq('tenant_id', ctx.tenantId)
    .eq('item_id', sourceItemId);
  if (svErr) throw svErr;
  const { data: tVars, error: tvErr } = await db
    .from('item_variants')
    .select('id, name, sku')
    .eq('tenant_id', ctx.tenantId)
    .eq('item_id', targetItemId);
  if (tvErr) throw tvErr;

  const variantMap = new Map<string, string>();
  for (const v of (sVars ?? []) as PublishRow[]) {
    const match = ((tVars ?? []) as { id: string; name: string; sku: string | null }[]).find(
      (t) =>
        (v.sku && t.sku === v.sku) ||
        (!v.sku && t.name.toLowerCase() === String(v.name).toLowerCase()),
    );
    const cols = {
      name: v.name,
      price_adjustment: v.price_adjustment,
      is_active: v.is_active,
      sku_source: v.sku_source,
    };
    if (match) {
      variantMap.set(v.id, match.id);
      if (update) {
        const { error } = await db
          .from('item_variants')
          .update(cols)
          .eq('id', match.id)
          .eq('tenant_id', ctx.tenantId);
        if (error) throw error;
      }
      continue;
    }
    // The SKU is unique per branch: when another item of the target branch already owns it, keep the variant without a SKU.
    let sku: string | null = (v.sku as string | null) || null;
    if (sku) {
      const { data: clash } = await db
        .from('item_variants')
        .select('id')
        .eq('tenant_id', ctx.tenantId)
        .eq('branch_id', targetBranchId)
        .eq('sku', sku)
        .limit(1);
      if (clash && clash.length) sku = null;
    }
    const { data: created, error } = await db
      .from('item_variants')
      .insert({
        ...cols,
        sku,
        stock_quantity: 0,
        item_id: targetItemId,
        tenant_id: ctx.tenantId,
        branch_id: targetBranchId,
      })
      .select('id')
      .single();
    if (error) throw error;
    variantMap.set(v.id, (created as { id: string }).id);
  }

  const { data: sBars, error: sbErr } = await db
    .from('item_barcodes')
    .select('*')
    .eq('tenant_id', ctx.tenantId)
    .eq('item_id', sourceItemId)
    .is('deleted_at', null);
  if (sbErr) throw sbErr;
  for (const b of (sBars ?? []) as PublishRow[]) {
    const { data: clash, error: cErr } = await db
      .from('item_barcodes')
      .select('id')
      .eq('tenant_id', ctx.tenantId)
      .eq('branch_id', targetBranchId)
      .eq('barcode', b.barcode)
      .is('deleted_at', null)
      .limit(1);
    if (cErr) throw cErr;
    if (clash && clash.length) continue; // already there (this item or another): never fail on a collision
    const { error } = await db.from('item_barcodes').insert({
      item_id: targetItemId,
      variant_id: b.variant_id ? (variantMap.get(b.variant_id) ?? null) : null,
      barcode: b.barcode,
      barcode_type: b.barcode_type,
      is_primary: b.is_primary,
      packaging_level_id: null,
      tenant_id: ctx.tenantId,
      branch_id: targetBranchId,
    });
    if (error) throw error;
  }
}

/** Items (+ variants, barcodes, category and units mapped to the target branch by name). */
export function itemsPublisher(cache?: RedisCacheService): EntityPublisher {
  const live = (ctx: PublishContext, branchId: string) =>
    ctx.db
      .from('items')
      .select('*')
      .eq('tenant_id', ctx.tenantId)
      .eq('branch_id', branchId)
      .is('deleted_at', null);

  return {
    type: 'items',
    group: 'catalog',
    labelAr: 'الأصناف',
    labelEn: 'Items',
    supported: true,

    async loadSources(ctx, ids) {
      const { data, error } = await live(ctx, ctx.sourceBranchId).in('id', ids);
      if (error) throw error;
      return (data ?? []) as PublishRow[];
    },

    async listSourceIds(ctx) {
      const { data, error } = await live(ctx, ctx.sourceBranchId);
      if (error) throw error;
      return ((data ?? []) as { id: string }[]).map((r) => r.id);
    },

    async findExisting(ctx, row, targetBranchId) {
      let q = live(ctx, targetBranchId);
      if (row.sku) q = q.eq('sku', row.sku);
      else q = q.ilike('name', escapeLike(String(row.name)));
      const { data, error } = await q.limit(1);
      if (error) throw error;
      return (data?.[0] as { id: string } | undefined)?.id ?? null;
    },

    async exists(ctx, targetId, targetBranchId) {
      const { data, error } = await live(ctx, targetBranchId)
        .eq('id', targetId)
        .limit(1);
      if (error) throw error;
      return (data ?? []).length > 0;
    },

    async create(ctx, row, targetBranchId) {
      const cols = await itemColumns(ctx, row, targetBranchId);
      const insert = (c: Record<string, unknown>) =>
        ctx.db
          .from('items')
          .insert({ ...c, tenant_id: ctx.tenantId, branch_id: targetBranchId })
          .select('id')
          .single();
      let { data, error } = await insert(cols);
      // A soft-deleted row of the target may still own the SKU: keep the item, drop the clashing SKU.
      if (error?.code === '23505' && cols.sku) {
        ({ data, error } = await insert({ ...cols, sku: null }));
      }
      if (error) throw error;
      const id = (data as unknown as { id: string }).id;
      await syncChildren(ctx, row.id, id, targetBranchId, false);
      return id;
    },

    async update(ctx, row, targetId, targetBranchId) {
      const cols = await itemColumns(ctx, row, targetBranchId);
      // The target keeps its own SKU: it is the natural key that matched it.
      delete cols.sku;
      const { error } = await ctx.db
        .from('items')
        .update({ ...cols, updated_at: new Date().toISOString() })
        .eq('id', targetId)
        .eq('tenant_id', ctx.tenantId)
        .eq('branch_id', targetBranchId);
      if (error) throw error;
      await syncChildren(ctx, row.id, targetId, targetBranchId, true);
    },

    async afterPublish(ctx) {
      await cache?.delByPrefix(`items:list:tenant:${ctx.tenantId}:`);
    },
  };
}
