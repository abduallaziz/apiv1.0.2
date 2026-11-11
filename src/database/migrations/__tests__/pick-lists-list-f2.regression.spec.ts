// Regression suite for Inventory #7 / F2 — Pick Lists List + Filters.
// Exercises the actual WmsRepository.findPickLists code path (the same
// class the controller calls) directly against the real Supabase project,
// same pattern as every other regression suite in this directory. Rows are
// inserted straight into pick_lists (bypassing fn_create_pick_list's
// business-rule validation) since this suite tests the F17 list/filter/
// sort/pagination query itself, not pick-list creation rules.
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { WmsRepository } from '../../../modules/inventory/repositories/wms.repository';

dotenv.config();

const TENANT = '9bcd3369-d664-47c8-b297-3bc9b429aacf'; // Sefay Demo

describe('Pick Lists List + Filters (Inventory #7 / F2)', () => {
  let supabase: SupabaseClient;
  let repo: WmsRepository;
  let warehouseId: string;
  let warehouseId2: string;
  const cleanupWarehouseIds: string[] = [];
  const cleanupPickListIds: string[] = [];

  beforeAll(async () => {
    supabase = createClient(
      process.env.SUPABASE_URL as string,
      process.env.SUPABASE_SERVICE_ROLE_KEY as string,
    );
    repo = new WmsRepository(supabase);

    const { data: wh } = await supabase
      .from('warehouses')
      .select('id, branch_id')
      .eq('tenant_id', TENANT)
      .limit(1);
    warehouseId = wh![0].id;

    const { data: wh2 } = await supabase
      .from('warehouses')
      .insert({
        tenant_id: TENANT,
        branch_id: wh![0].branch_id,
        name: 'F2 List WH2',
        code: `F2LQ-${Date.now()}`,
      })
      .select()
      .single();
    warehouseId2 = wh2.id;
    cleanupWarehouseIds.push(wh2.id);

    // 10 pick lists: 4 single/wh1, 3 batch/wh2, 3 zone/wh1 — priorities and
    // statuses varied so filters/sort have something real to narrow/order.
    const rows = [
      { strategy: 'single', priority: 'low', status: 'open', wh: warehouseId },
      { strategy: 'single', priority: 'high', status: 'open', wh: warehouseId },
      { strategy: 'single', priority: 'urgent', status: 'in_progress', wh: warehouseId },
      { strategy: 'single', priority: 'medium', status: 'completed', wh: warehouseId },
      { strategy: 'batch', priority: 'low', status: 'open', wh: warehouseId2 },
      { strategy: 'batch', priority: 'high', status: 'in_progress', wh: warehouseId2 },
      { strategy: 'batch', priority: 'urgent', status: 'cancelled', wh: warehouseId2 },
      { strategy: 'zone', priority: 'medium', status: 'open', wh: warehouseId, zone: true },
      { strategy: 'zone', priority: 'high', status: 'open', wh: warehouseId, zone: true },
      { strategy: 'zone', priority: 'low', status: 'in_progress', wh: warehouseId, zone: true },
    ];

    let zoneLocationId: string | null = null;
    const { data: loc } = await supabase
      .from('warehouse_locations')
      .select('id')
      .eq('warehouse_id', warehouseId)
      .limit(1);
    zoneLocationId = loc?.[0]?.id ?? null;

    for (const [i, r] of rows.entries()) {
      const { data: pl, error } = await supabase
        .from('pick_lists')
        .insert({
          tenant_id: TENANT,
          warehouse_id: r.wh,
          strategy: r.strategy,
          status: r.status,
          priority: r.priority,
          zone_location_id: r.zone && zoneLocationId ? zoneLocationId : null,
          created_at: new Date(Date.now() - (rows.length - i) * 1000).toISOString(),
        })
        .select()
        .single();
      if (error) throw error;
      cleanupPickListIds.push(pl.id);
    }
  }, 30000);

  afterAll(async () => {
    await supabase.from('pick_lists').delete().in('id', cleanupPickListIds);
    await supabase.from('warehouses').delete().in('id', cleanupWarehouseIds);
  }, 30000);

  it('1. unpaged call (no `page`) preserves legacy array response', async () => {
    const result = await repo.findPickLists(TENANT, {});
    expect(Array.isArray(result)).toBe(true);
    const ids = (result as { id: string }[]).map((r) => r.id);
    for (const id of cleanupPickListIds) expect(ids).toContain(id);
  });

  it('2. paged call returns {data,total,page,perPage} with the real total, not just this page length', async () => {
    const result = await repo.findPickLists(TENANT, { page: 1, limit: 3 });
    expect(Array.isArray(result)).toBe(false);
    const paged = result as { data: unknown[]; total: number; page: number; perPage: number };
    expect(paged.data.length).toBe(3);
    expect(paged.total).toBeGreaterThanOrEqual(10);
    expect(paged.page).toBe(1);
    expect(paged.perPage).toBe(3);
  });

  it('3. pagination across pages has no duplicates and no gaps for this seeded set', async () => {
    const page1 = await repo.findPickLists(TENANT, {
      page: 1, limit: 5, warehouse_id: warehouseId, sortBy: 'created_at', sortOrder: 'asc',
    }) as { data: { id: string }[] };
    const page2 = await repo.findPickLists(TENANT, {
      page: 2, limit: 5, warehouse_id: warehouseId, sortBy: 'created_at', sortOrder: 'asc',
    }) as { data: { id: string }[] };
    const ids1 = page1.data.map((r) => r.id);
    const ids2 = page2.data.map((r) => r.id);
    expect(ids1.filter((id) => ids2.includes(id))).toHaveLength(0); // no duplicates
    const combined = new Set([...ids1, ...ids2]);
    const wh1SeededIds = cleanupPickListIds.slice(0, 4).concat(cleanupPickListIds.slice(7)); // single(x4) + zone(x3) are in wh1
    for (const id of wh1SeededIds) expect(combined.has(id)).toBe(true); // no gaps
  });

  it('4. warehouse_id filter is a real DB-level filter — no cross-warehouse leak', async () => {
    const result = await repo.findPickLists(TENANT, { page: 1, limit: 20, warehouse_id: warehouseId2 }) as { data: { warehouse_id: string }[] };
    expect(result.data.length).toBe(3); // the 3 batch/wh2 rows
    for (const row of result.data) expect(row.warehouse_id).toBe(warehouseId2);
  });

  it('5. strategy + priority + status filters compose (AND, not OR)', async () => {
    const result = await repo.findPickLists(TENANT, {
      page: 1, limit: 20, strategy: 'zone', priority: 'high', status: 'open',
    }) as { data: { id: string }[] };
    expect(result.data.length).toBe(1);
  });

  it('6. sortBy=priority sorts by the literal column (text order), consistently between asc/desc', async () => {
    const asc = await repo.findPickLists(TENANT, { page: 1, limit: 20, sortBy: 'priority', sortOrder: 'asc' }) as { data: { priority: string }[] };
    const desc = await repo.findPickLists(TENANT, { page: 1, limit: 20, sortBy: 'priority', sortOrder: 'desc' }) as { data: { priority: string }[] };
    expect(asc.data.map((r) => r.priority)).toEqual([...desc.data.map((r) => r.priority)].reverse());
  });

  it('7. tenant isolation: a second tenant sees zero of these rows regardless of filters', async () => {
    const { data: otherTenant } = await supabase.from('tenants').select('id').neq('id', TENANT).limit(1);
    if (!otherTenant?.[0]) return; // no second tenant available in this environment — skip rather than fail
    const result = await repo.findPickLists(otherTenant[0].id, { page: 1, limit: 100 }) as { data: { id: string }[] };
    const leaked = result.data.filter((r) => cleanupPickListIds.includes(r.id));
    expect(leaked).toHaveLength(0);
  });
});
