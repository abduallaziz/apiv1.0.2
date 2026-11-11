// Regression suite for Inventory #7 / F7 — Wave Overview / Wave Management.
// Exercises the actual WmsRepository.findWaves/findWaveById code paths (the
// same class the controller calls) directly against the real Supabase
// project, same pattern as every other regression suite in this directory.
// Rows are inserted straight into `waves` for the pagination/filter/sort
// matrix (bypassing fn_evaluate_wave_eligibility/fn_release_wave/
// fn_cancel_wave's business-rule validation) since this suite tests the
// F17 list/filter/sort/pagination query itself, not wave lifecycle rules
// (already covered by the 7-5/7-6 regression suites). A separate small
// block at the end drives one wave through the REAL lifecycle RPCs
// (create -> evaluate -> release) to prove findWaveById reflects real
// state, not just inserted rows.
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { WmsRepository } from '../../../modules/inventory/repositories/wms.repository';

dotenv.config();

const TENANT = '9bcd3369-d664-47c8-b297-3bc9b429aacf'; // Sefay Demo

describe('Wave Overview / Wave Management (Inventory #7 / F7)', () => {
  let supabase: SupabaseClient;
  let repo: WmsRepository;
  let warehouseId: string;
  let warehouseId2: string;
  let actorId: string;
  const cleanupWarehouseIds: string[] = [];
  const cleanupWaveIds: string[] = [];

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
    const branchId = wh![0].branch_id;

    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('tenant_id', TENANT)
      .limit(1);
    actorId = user![0].id;

    // The shared demo tenant's pre-existing warehouse (`wh[0].id`) has
    // accumulated hundreds of historical waves from months of regression
    // runs across this whole directory — the same class of shared-fixture
    // contamination diagnosed and fixed for F7's analytics-timeout
    // stability gate. Both list-scope warehouses here are freshly created
    // and guaranteed empty, so count/pagination assertions are exact.
    const { data: wh1 } = await supabase
      .from('warehouses')
      .insert({ tenant_id: TENANT, branch_id: branchId, name: 'F7 List WH1', code: `F7LQ1-${Date.now()}` })
      .select()
      .single();
    warehouseId = wh1.id;
    cleanupWarehouseIds.push(wh1.id);

    const { data: wh2 } = await supabase
      .from('warehouses')
      .insert({
        tenant_id: TENANT,
        branch_id: branchId,
        name: 'F7 List WH2',
        code: `F7LQ2-${Date.now()}`,
      })
      .select()
      .single();
    warehouseId2 = wh2.id;
    cleanupWarehouseIds.push(wh2.id);

    // 12 waves spanning every status a real wave row can hold, split
    // across 2 warehouses so filters/sort have something real to narrow.
    const rows: { status: string; wh: string }[] = [
      { status: 'planning', wh: warehouseId },
      { status: 'planning', wh: warehouseId },
      { status: 'planning', wh: warehouseId2 },
      { status: 'evaluating', wh: warehouseId },
      { status: 'reviewing', wh: warehouseId },
      { status: 'reviewing', wh: warehouseId2 },
      { status: 'released', wh: warehouseId },
      { status: 'released', wh: warehouseId2 },
      { status: 'picking', wh: warehouseId },
      { status: 'completed', wh: warehouseId },
      { status: 'cancelled', wh: warehouseId },
      { status: 'cancelled', wh: warehouseId2 },
    ];

    for (const [i, r] of rows.entries()) {
      const timestamps: Record<string, string | null> = {
        evaluated_at: ['evaluating', 'reviewing', 'released', 'picking', 'completed'].includes(r.status) ? new Date().toISOString() : null,
        released_at: ['released', 'picking', 'completed'].includes(r.status) ? new Date().toISOString() : null,
        completed_at: r.status === 'completed' ? new Date().toISOString() : null,
        cancelled_at: r.status === 'cancelled' ? new Date().toISOString() : null,
      };
      const { data: w, error } = await supabase
        .from('waves')
        .insert({
          tenant_id: TENANT,
          warehouse_id: r.wh,
          status: r.status,
          criteria: { priority_min: 'low' },
          created_by: actorId,
          cancellation_reason: r.status === 'cancelled' ? 'F7 regression seed' : null,
          created_at: new Date(Date.now() - (rows.length - i) * 1000).toISOString(),
          ...timestamps,
        })
        .select()
        .single();
      if (error) throw error;
      cleanupWaveIds.push(w.id);
    }
  }, 30000);

  afterAll(async () => {
    await supabase.from('waves').delete().in('id', cleanupWaveIds);
    await supabase.from('warehouses').delete().in('id', cleanupWarehouseIds);
  }, 30000);

  it('1. unpaged call (no `page`) preserves legacy array response', async () => {
    const result = await repo.findWaves(TENANT, {});
    expect(Array.isArray(result)).toBe(true);
    const ids = (result as { id: string }[]).map((r) => r.id);
    for (const id of cleanupWaveIds) expect(ids).toContain(id);
  });

  it('2. paged call returns {data,total,page,perPage} with the real total, not just this page length', async () => {
    const result = await repo.findWaves(TENANT, { page: 1, limit: 3 });
    expect(Array.isArray(result)).toBe(false);
    const paged = result as { data: unknown[]; total: number; page: number; perPage: number };
    expect(paged.data.length).toBe(3);
    expect(paged.total).toBeGreaterThanOrEqual(12);
    expect(paged.page).toBe(1);
    expect(paged.perPage).toBe(3);
  });

  it('3. pagination across pages has no duplicates and no gaps for this seeded warehouse-1 set', async () => {
    // Indices into the beforeAll `rows` array (and thus cleanupWaveIds,
    // inserted in the same order) whose `wh` is warehouseId (not wh2):
    // planning, planning, evaluating, reviewing, released, picking,
    // completed, cancelled — 8 of the 12 seeded rows.
    const wh1Indices = [0, 1, 3, 4, 6, 8, 9, 10];
    const wh1SeededIds = wh1Indices.map((i) => cleanupWaveIds[i]);
    const page1 = await repo.findWaves(TENANT, {
      page: 1, limit: 5, warehouse_id: warehouseId, sortBy: 'created_at', sortOrder: 'asc',
    }) as { data: { id: string }[] };
    const page2 = await repo.findWaves(TENANT, {
      page: 2, limit: 5, warehouse_id: warehouseId, sortBy: 'created_at', sortOrder: 'asc',
    }) as { data: { id: string }[] };
    const ids1 = page1.data.map((r) => r.id);
    const ids2 = page2.data.map((r) => r.id);
    expect(ids1.filter((id) => ids2.includes(id))).toHaveLength(0); // no duplicates
    const combined = new Set([...ids1, ...ids2]);
    for (const id of wh1SeededIds) expect(combined.has(id)).toBe(true); // no gaps
  });

  it('4. warehouse_id filter is a real DB-level filter — no cross-warehouse leak', async () => {
    const result = await repo.findWaves(TENANT, { page: 1, limit: 20, warehouse_id: warehouseId2 }) as { data: { warehouse_id: string }[] };
    expect(result.data.length).toBe(4); // the 4 wh2 rows
    for (const row of result.data) expect(row.warehouse_id).toBe(warehouseId2);
  });

  it('5. status filter is exact, one real status at a time', async () => {
    // Scoped to wh1 only (1 of the 2 seeded 'reviewing' rows) — the shared
    // demo tenant's other warehouse(s) carry unrelated historical
    // 'reviewing' waves from past regression runs, same class of
    // contamination the F7 stability audit already documented.
    const result = await repo.findWaves(TENANT, { page: 1, limit: 20, status: 'reviewing', warehouse_id: warehouseId }) as { data: { status: string }[] };
    expect(result.data.length).toBe(1);
    for (const row of result.data) expect(row.status).toBe('reviewing');
  });

  it('6. status + warehouse_id filters compose (AND, not OR)', async () => {
    const result = await repo.findWaves(TENANT, {
      page: 1, limit: 20, status: 'cancelled', warehouse_id: warehouseId2,
    }) as { data: { id: string }[] };
    expect(result.data.length).toBe(1);
  });

  it('7. sortBy=status sorts by the literal column (text order), consistently between asc/desc', async () => {
    const asc = await repo.findWaves(TENANT, { page: 1, limit: 20, warehouse_id: warehouseId, sortBy: 'status', sortOrder: 'asc' }) as { data: { status: string }[] };
    const desc = await repo.findWaves(TENANT, { page: 1, limit: 20, warehouse_id: warehouseId, sortBy: 'status', sortOrder: 'desc' }) as { data: { status: string }[] };
    expect(asc.data.map((r) => r.status)).toEqual([...desc.data.map((r) => r.status)].reverse());
  });

  it('8. every real DB-constraint-allowed status value round-trips through the list unmangled', async () => {
    const allStatuses = ['planning', 'evaluating', 'reviewing', 'released', 'picking', 'completed', 'cancelled'];
    const wh1 = await repo.findWaves(TENANT, { page: 1, limit: 20, warehouse_id: warehouseId }) as { data: { id: string; status: string }[] };
    const wh2 = await repo.findWaves(TENANT, { page: 1, limit: 20, warehouse_id: warehouseId2 }) as { data: { id: string; status: string }[] };
    const seededRows = [...wh1.data, ...wh2.data].filter((r) => cleanupWaveIds.includes(r.id));
    const seenStatuses = new Set(seededRows.map((r) => r.status));
    for (const s of allStatuses) expect(seenStatuses.has(s)).toBe(true);
  });

  it('9. tenant isolation: a second tenant sees zero of these rows regardless of filters', async () => {
    const { data: otherTenant } = await supabase.from('tenants').select('id').neq('id', TENANT).limit(1);
    if (!otherTenant?.[0]) return; // no second tenant available in this environment — skip rather than fail
    const result = await repo.findWaves(otherTenant[0].id, { page: 1, limit: 100 }) as { data: { id: string }[] };
    const leaked = result.data.filter((r) => cleanupWaveIds.includes(r.id));
    expect(leaked).toHaveLength(0);
  });

  it('10. empty dataset: an unrelated warehouse with zero waves returns an empty page, not an error', async () => {
    const { data: emptyWh } = await supabase
      .from('warehouses')
      .insert({ tenant_id: TENANT, branch_id: (await supabase.from('warehouses').select('branch_id').eq('id', warehouseId).single()).data!.branch_id, name: 'F7 Empty WH', code: `F7EMPTY-${Date.now()}` })
      .select()
      .single();
    try {
      const result = await repo.findWaves(TENANT, { page: 1, limit: 20, warehouse_id: emptyWh.id }) as { data: unknown[]; total: number };
      expect(result.data).toHaveLength(0);
      expect(result.total).toBe(0);
    } finally {
      await supabase.from('warehouses').delete().eq('id', emptyWh.id);
    }
  });

  it('11. findWaveById returns the real row by id, scoped to tenant', async () => {
    const target = cleanupWaveIds[0];
    const found = await repo.findWaveById(target, TENANT);
    expect(found).toBeTruthy();
    expect((found as { id: string }).id).toBe(target);
  });

  it('12. findWaveById returns null for a real id under the wrong tenant (tenant isolation on detail)', async () => {
    const { data: otherTenant } = await supabase.from('tenants').select('id').neq('id', TENANT).limit(1);
    if (!otherTenant?.[0]) return;
    const found = await repo.findWaveById(cleanupWaveIds[0], otherTenant[0].id);
    expect(found).toBeNull();
  });

  it('12b. findWaveHistory returns an empty array (not an error) for a wave that was never evaluated', async () => {
    // cleanupWaveIds[0] is a 'planning' row inserted directly in beforeAll,
    // never passed through fn_evaluate_wave_eligibility — no real history
    // rows exist for it.
    const history = await repo.findWaveHistory(cleanupWaveIds[0], TENANT);
    expect(Array.isArray(history)).toBe(true);
    expect(history).toHaveLength(0);
  });

  it('12c. findWaveHistory is tenant-isolated — a real wave id under the wrong tenant returns nothing', async () => {
    const { data: otherTenant } = await supabase.from('tenants').select('id').neq('id', TENANT).limit(1);
    if (!otherTenant?.[0]) return;
    const history = await repo.findWaveHistory(cleanupWaveIds[0], otherTenant[0].id);
    expect(history).toHaveLength(0);
  });

  // Real lifecycle: create -> evaluate -> release, driven entirely through
  // the real RPCs (fn_evaluate_wave_eligibility, fn_release_wave), not
  // direct inserts — proves findWaveById reflects genuine backend state
  // transitions the F7 detail drawer will actually observe.
  it('13. a wave driven through the real create->evaluate->release lifecycle is reflected correctly by findWaveById', async () => {
    // fn_release_wave's claim step needs a real pending shipment with a
    // real line and real available stock to actually claim/reserve
    // against (migration 238's zero-claim path is exercised separately —
    // test 5's 'reviewing'-only wave never calls release at all). Direct
    // inserts here, not fn_apply_stock_movement/fn_post_goods_receipt,
    // since this suite is testing the wave list/detail read path, not
    // goods-receipt business rules (already covered elsewhere).
    const { data: item, error: itemErr } = await supabase.from('items').insert({
      tenant_id: TENANT, name: 'F7 Lifecycle Item', type: 'product', operation_type: 'sell', price: 10, is_active: true,
    }).select().single();
    if (itemErr) throw itemErr;
    const { data: movement, error: movErr } = await supabase.from('stock_movements').insert({
      tenant_id: TENANT, warehouse_id: warehouseId, item_id: item.id, movement_type: 'receipt', direction: 'in',
      quantity: 100, unit_cost: 5, total_cost: 500, reference_type: 'f7_regression_seed',
    }).select().single();
    if (movErr) throw movErr;
    const { error: levelErr } = await supabase.from('stock_levels').insert({
      tenant_id: TENANT, warehouse_id: warehouseId, item_id: item.id, quantity_on_hand: 100,
    });
    if (levelErr) throw levelErr;
    const { error: layerErr } = await supabase.from('cost_layers').insert({
      tenant_id: TENANT, warehouse_id: warehouseId, item_id: item.id, source_movement_id: movement.id,
      unit_cost: 5, quantity_received: 100, quantity_remaining: 100,
    });
    if (layerErr) throw layerErr;
    const { data: shipment, error: shipErr } = await supabase.from('shipments').insert({
      tenant_id: TENANT, warehouse_id: warehouseId, reference_type: 'order', reference_id: crypto.randomUUID(), status: 'pending',
    }).select().single();
    if (shipErr) throw shipErr;
    const { error: lineErr } = await supabase.from('shipment_lines').insert({
      tenant_id: TENANT, shipment_id: shipment.id, item_id: item.id, quantity_requested: 5,
    });
    if (lineErr) throw lineErr;

    const { data: wave, error: waveErr } = await supabase
      .from('waves')
      .insert({ tenant_id: TENANT, warehouse_id: warehouseId, status: 'planning', criteria: {} })
      .select()
      .single();
    if (waveErr) throw waveErr;
    cleanupWaveIds.push(wave.id);

    const { error: evalErr } = await supabase.rpc('fn_evaluate_wave_eligibility', {
      p_wave_id: wave.id, p_tenant_id: TENANT, p_actor_id: actorId,
    });
    if (evalErr) throw evalErr;

    const afterEval = await repo.findWaveById(wave.id, TENANT) as { status: string; evaluated_at: string | null };
    expect(afterEval.status).toBe('reviewing');
    expect(afterEval.evaluated_at).not.toBeNull();

    const { error: releaseErr } = await supabase.rpc('fn_release_wave', {
      p_wave_id: wave.id, p_tenant_id: TENANT, p_actor_id: actorId, p_priority: 'medium',
    });
    if (releaseErr) throw releaseErr;

    // F7 lifecycle gap closure (migration 248): fn_release_wave now
    // advances released -> picking synchronously in the same
    // transaction, since the pick list it just created is already
    // 'in_progress' — there is no real "released but not yet picking"
    // moment to observe. released_at is still set regardless.
    const afterRelease = await repo.findWaveById(wave.id, TENANT) as { status: string; released_at: string | null };
    expect(afterRelease.status).toBe('picking');
    expect(afterRelease.released_at).not.toBeNull();

    // F7 gap closure — real warehouse_work_status_history rows written by
    // the RPCs just called, read back through the new findWaveHistory
    // endpoint (mirrors findPickListHistory exactly, same table, entity_
    // type='wave'). Three real transitions happened above: planning->
    // reviewing (evaluate), reviewing->released, released->picking
    // (both from the same release call).
    const history = await repo.findWaveHistory(wave.id, TENANT) as {
      entity_type: string; entity_id: string; old_status: string | null; new_status: string; created_at: string;
    }[];
    expect(history.length).toBeGreaterThanOrEqual(3);
    for (const h of history) {
      expect(h.entity_type).toBe('wave');
      expect(h.entity_id).toBe(wave.id);
    }
    // Descending order (newest first), matching findPickListHistory's
    // exact ordering convention.
    const sortedDesc = [...history].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    expect(history.map((h) => h.created_at)).toEqual(sortedDesc.map((h) => h.created_at));
    const releasedEntry = history.find((h) => h.new_status === 'released');
    expect(releasedEntry).toBeTruthy();
    expect(releasedEntry!.old_status).toBe('reviewing');
    const reviewingEntry = history.find((h) => h.new_status === 'reviewing');
    expect(reviewingEntry).toBeTruthy();

    // Scoped cleanup for this test's own fixtures (stock_movements is an
    // append-only ledger and left in place, same established exception
    // across this whole directory).
    const { data: pl } = await supabase.from('pick_lists').select('id').eq('wave_id', wave.id);
    const plIds = (pl ?? []).map((p) => p.id);
    await supabase.from('stock_reservations').delete().eq('tenant_id', TENANT).eq('reference_type', 'pick_list_line');
    await supabase.from('pick_list_lines').delete().in('pick_list_id', plIds);
    await supabase.from('pick_list_shipments').delete().in('pick_list_id', plIds);
    await supabase.from('pick_lists').delete().in('id', plIds);
    await supabase.from('shipment_lines').delete().eq('shipment_id', shipment.id);
    await supabase.from('shipments').delete().eq('id', shipment.id);
    await supabase.from('cost_layers').delete().eq('item_id', item.id);
    await supabase.from('stock_levels').delete().eq('item_id', item.id);
    await supabase.from('items').delete().eq('id', item.id);
  }, 20000);
});
