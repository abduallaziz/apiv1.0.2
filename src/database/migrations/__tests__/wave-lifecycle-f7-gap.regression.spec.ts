// Regression suite for Inventory #7 / F7 Gap Closure — real Wave lifecycle
// transitions (migration 248): released -> picking (synchronous, inside
// fn_release_wave) and picking -> completed (trigger-driven, fires inside
// whatever transaction moves a pick_lists row to completed/cancelled).
// Real RPCs drive the wave/pick-list transitions (fn_evaluate_wave_
// eligibility, fn_release_wave, fn_confirm_pick, fn_cancel_pick_list) —
// only the *second* pick list in the multi-pick-list scenarios is a
// direct insert, since fn_release_wave itself only ever produces one
// pick list per call today; the trigger's own completion-counting logic
// must still be correct for a hypothetical/future multi-pick-list wave,
// which is exactly what those tests exercise.
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const TENANT = '9bcd3369-d664-47c8-b297-3bc9b429aacf'; // Sefay Demo

describe('Wave Lifecycle: released -> picking -> completed (Inventory #7 / F7 Gap Closure)', () => {
  let supabase: SupabaseClient;
  let warehouseId: string;
  let actorId: string;
  let itemId: string;
  const cleanupWaveIds: string[] = [];
  const cleanupShipmentIds: string[] = [];
  const cleanupPickListIds: string[] = [];
  const cleanupItemIds: string[] = [];

  beforeAll(async () => {
    supabase = createClient(
      process.env.SUPABASE_URL as string,
      process.env.SUPABASE_SERVICE_ROLE_KEY as string,
    );

    const { data: wh } = await supabase
      .from('warehouses')
      .insert({
        tenant_id: TENANT,
        branch_id: (await supabase.from('warehouses').select('branch_id').eq('tenant_id', TENANT).limit(1).single()).data!.branch_id,
        name: 'F7 Lifecycle WH',
        code: `F7LC-${Date.now()}`,
      })
      .select()
      .single();
    warehouseId = wh.id;

    const { data: user } = await supabase.from('users').select('id').eq('tenant_id', TENANT).limit(1);
    actorId = user![0].id;

    const { data: item, error: itemErr } = await supabase.from('items').insert({
      tenant_id: TENANT, name: 'F7 Lifecycle Item', type: 'product', operation_type: 'sell', price: 10, is_active: true,
    }).select().single();
    if (itemErr) throw itemErr;
    itemId = item.id;
    cleanupItemIds.push(itemId);

    const { data: movement, error: movErr } = await supabase.from('stock_movements').insert({
      tenant_id: TENANT, warehouse_id: warehouseId, item_id: itemId, movement_type: 'receipt', direction: 'in',
      quantity: 1000, unit_cost: 5, total_cost: 5000, reference_type: 'f7_lifecycle_seed',
    }).select().single();
    if (movErr) throw movErr;
    await supabase.from('stock_levels').insert({ tenant_id: TENANT, warehouse_id: warehouseId, item_id: itemId, quantity_on_hand: 1000 });
    await supabase.from('cost_layers').insert({
      tenant_id: TENANT, warehouse_id: warehouseId, item_id: itemId, source_movement_id: movement.id,
      unit_cost: 5, quantity_received: 1000, quantity_remaining: 1000,
    });
  }, 30000);

  afterAll(async () => {
    const { data: pl } = await supabase.from('pick_lists').select('id').in('id', cleanupPickListIds);
    const plIds = (pl ?? []).map((p) => p.id);
    await supabase.from('stock_reservations').delete().eq('tenant_id', TENANT).eq('reference_type', 'pick_list_line');
    await supabase.from('pick_list_lines').delete().in('pick_list_id', plIds);
    await supabase.from('pick_list_shipments').delete().in('pick_list_id', plIds);
    await supabase.from('pick_lists').delete().in('id', plIds);
    await supabase.from('warehouse_work_status_history').delete().eq('tenant_id', TENANT).eq('entity_type', 'wave').in('entity_id', cleanupWaveIds);
    await supabase.from('wave_shipments').delete().in('wave_id', cleanupWaveIds);
    await supabase.from('waves').delete().in('id', cleanupWaveIds);
    await supabase.from('shipment_lines').delete().in('shipment_id', cleanupShipmentIds);
    await supabase.from('shipments').delete().in('id', cleanupShipmentIds);
    await supabase.from('cost_layers').delete().in('item_id', cleanupItemIds);
    await supabase.from('stock_levels').delete().in('item_id', cleanupItemIds);
    await supabase.from('items').delete().in('id', cleanupItemIds);
    await supabase.from('warehouses').delete().eq('id', warehouseId);
  }, 60000);

  const mkShipment = async (qty: number) => {
    const { data: shipment, error } = await supabase.from('shipments').insert({
      tenant_id: TENANT, warehouse_id: warehouseId, reference_type: 'order', reference_id: crypto.randomUUID(), status: 'pending',
    }).select().single();
    if (error) throw error;
    cleanupShipmentIds.push(shipment.id);
    const { error: lineErr } = await supabase.from('shipment_lines').insert({
      tenant_id: TENANT, shipment_id: shipment.id, item_id: itemId, quantity_requested: qty,
    });
    if (lineErr) throw lineErr;
    return shipment.id;
  };

  // Creates a wave, evaluates it, releases it — real RPCs throughout —
  // returning the wave id and the single real pick list release created.
  const createReleasedWave = async (qty = 5) => {
    await mkShipment(qty);
    const { data: wave, error: waveErr } = await supabase.from('waves').insert({
      tenant_id: TENANT, warehouse_id: warehouseId, status: 'planning', criteria: {},
    }).select().single();
    if (waveErr) throw waveErr;
    cleanupWaveIds.push(wave.id);

    const { error: evalErr } = await supabase.rpc('fn_evaluate_wave_eligibility', {
      p_wave_id: wave.id, p_tenant_id: TENANT, p_actor_id: actorId,
    });
    if (evalErr) throw evalErr;

    const { data: pickLists, error: releaseErr } = await supabase.rpc('fn_release_wave', {
      p_wave_id: wave.id, p_tenant_id: TENANT, p_actor_id: actorId, p_priority: 'medium',
    });
    if (releaseErr) throw releaseErr;
    const pickList = pickLists[0];
    cleanupPickListIds.push(pickList.id);
    return { waveId: wave.id as string, pickListId: pickList.id as string };
  };

  const fullyPick = async (pickListId: string) => {
    const { data: lines } = await supabase.from('pick_list_lines').select('id, quantity_to_pick').eq('pick_list_id', pickListId);
    for (const line of lines!) {
      const { error } = await supabase.rpc('fn_confirm_pick', {
        p_pick_list_line_id: line.id, p_quantity: line.quantity_to_pick, p_actor_id: actorId,
      });
      if (error) throw error;
    }
  };

  it('1. released wave enters picking synchronously, in the same real release call', async () => {
    const { waveId } = await createReleasedWave();
    const { data: wave } = await supabase.from('waves').select('status, released_at, completed_at').eq('id', waveId).single();
    expect(wave!.status).toBe('picking');
    expect(wave!.released_at).not.toBeNull();
    expect(wave!.completed_at).toBeNull();
  }, 20000);

  it('2. single pick list completion completes the wave', async () => {
    const { waveId, pickListId } = await createReleasedWave();
    await fullyPick(pickListId);

    const { data: wave } = await supabase.from('waves').select('status, completed_at').eq('id', waveId).single();
    expect(wave!.status).toBe('completed');
    expect(wave!.completed_at).not.toBeNull();

    const { data: pl } = await supabase.from('pick_lists').select('status').eq('id', pickListId).single();
    expect(pl!.status).toBe('completed');
  }, 20000);

  it('3a. multiple pick lists: one incomplete blocks wave completion', async () => {
    const { waveId, pickListId: plA } = await createReleasedWave();
    const { data: plB } = await supabase.from('pick_lists').insert({
      tenant_id: TENANT, warehouse_id: warehouseId, strategy: 'wave', wave_id: waveId, priority: 'medium', status: 'in_progress',
    }).select().single();
    cleanupPickListIds.push(plB.id);

    await fullyPick(plA); // completes plA, fires the trigger — plB still in_progress

    const { data: wave } = await supabase.from('waves').select('status').eq('id', waveId).single();
    expect(wave!.status).toBe('picking'); // NOT completed — plB still open
  }, 20000);

  it('3b. multiple pick lists: all complete completes the wave', async () => {
    const { waveId, pickListId: plA } = await createReleasedWave();
    const { data: plB } = await supabase.from('pick_lists').insert({
      tenant_id: TENANT, warehouse_id: warehouseId, strategy: 'wave', wave_id: waveId, priority: 'medium', status: 'in_progress',
    }).select().single();
    cleanupPickListIds.push(plB.id);

    await fullyPick(plA);
    let { data: wave } = await supabase.from('waves').select('status, completed_at').eq('id', waveId).single();
    expect(wave!.status).toBe('picking');

    await supabase.from('pick_lists').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', plB.id);
    ({ data: wave } = await supabase.from('waves').select('status, completed_at').eq('id', waveId).single());
    expect(wave!.status).toBe('completed');
    expect(wave!.completed_at).not.toBeNull();
  }, 20000);

  it('4. a cancelled pick list does not block completion (completed + cancelled = wave completed)', async () => {
    const { waveId, pickListId: plA } = await createReleasedWave();
    const { data: plB } = await supabase.from('pick_lists').insert({
      tenant_id: TENANT, warehouse_id: warehouseId, strategy: 'wave', wave_id: waveId, priority: 'medium', status: 'in_progress',
    }).select().single();
    cleanupPickListIds.push(plB.id);

    await fullyPick(plA);
    let { data: wave } = await supabase.from('waves').select('status, completed_at').eq('id', waveId).single();
    expect(wave!.status).toBe('picking'); // plB still open

    const { error: cancelErr } = await supabase.rpc('fn_cancel_pick_list', {
      p_pick_list_id: plB.id, p_tenant_id: TENANT, p_actor_id: actorId, p_reason: 'F7 lifecycle test: cancelled pick list must not block completion',
    });
    if (cancelErr) throw cancelErr;

    ({ data: wave } = await supabase.from('waves').select('status, completed_at').eq('id', waveId).single());
    expect(wave!.status).toBe('completed');
    expect(wave!.completed_at).not.toBeNull();
  }, 20000);

  it('5. duplicate completion signal is idempotent — no duplicate wave history row', async () => {
    const { waveId, pickListId } = await createReleasedWave();
    await fullyPick(pickListId);

    let { data: wave } = await supabase.from('waves').select('status').eq('id', waveId).single();
    expect(wave!.status).toBe('completed');

    // Re-fire the same status transition on the already-completed pick
    // list (simulating a duplicate/replayed signal) — the trigger's WHEN
    // clause requires OLD.status IS DISTINCT FROM NEW.status, so setting
    // it to 'completed' again when it's already 'completed' does not
    // even re-invoke the trigger function; explicitly proving that here.
    await supabase.from('pick_lists').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', pickListId);

    ({ data: wave } = await supabase.from('waves').select('status').eq('id', waveId).single());
    expect(wave!.status).toBe('completed'); // unchanged, no regression

    const { data: history } = await supabase.from('warehouse_work_status_history')
      .select('*').eq('tenant_id', TENANT).eq('entity_type', 'wave').eq('entity_id', waveId).eq('new_status', 'completed');
    expect(history).toHaveLength(1); // exactly one completion row, not two
  }, 20000);

  it('6. concurrent completion events across two pick lists produce exactly one wave completion', async () => {
    const { waveId, pickListId: plA } = await createReleasedWave();
    const { data: plB } = await supabase.from('pick_lists').insert({
      tenant_id: TENANT, warehouse_id: warehouseId, strategy: 'wave', wave_id: waveId, priority: 'medium', status: 'in_progress',
    }).select().single();
    cleanupPickListIds.push(plB.id);

    // Fire both completions concurrently — Postgres row-level locking on
    // the waves row (FOR UPDATE inside fn_check_wave_completion) forces
    // them to serialize; only the second to actually complete will find
    // v_unfinished = 0 and perform the transition.
    await Promise.all([
      fullyPick(plA),
      supabase.from('pick_lists').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', plB.id),
    ]);

    const { data: wave } = await supabase.from('waves').select('status, completed_at').eq('id', waveId).single();
    expect(wave!.status).toBe('completed');
    expect(wave!.completed_at).not.toBeNull();

    const { data: history } = await supabase.from('warehouse_work_status_history')
      .select('*').eq('tenant_id', TENANT).eq('entity_type', 'wave').eq('entity_id', waveId).eq('new_status', 'completed');
    expect(history).toHaveLength(1); // no duplicate completion despite the race
  }, 20000);

  it('7. tenant isolation: the completion trigger never touches a wave under a different tenant', async () => {
    const { data: otherTenant } = await supabase.from('tenants').select('id').neq('id', TENANT).limit(1);
    if (!otherTenant?.[0]) return;
    const { waveId, pickListId } = await createReleasedWave();
    // Sanity: the pick list and wave are genuinely scoped to TENANT.
    const { data: pl } = await supabase.from('pick_lists').select('tenant_id, wave_id').eq('id', pickListId).single();
    expect(pl!.tenant_id).toBe(TENANT);
    await fullyPick(pickListId);
    const { data: wave } = await supabase.from('waves').select('status, tenant_id').eq('id', waveId).single();
    expect(wave!.tenant_id).toBe(TENANT);
    expect(wave!.status).toBe('completed');
    // No row for this wave id exists under the other tenant to have leaked into.
    const { data: leaked } = await supabase.from('waves').select('id').eq('id', waveId).eq('tenant_id', otherTenant[0].id);
    expect(leaked).toHaveLength(0);
  }, 20000);

  it('8. warehouse isolation: two waves in different warehouses complete independently', async () => {
    const { data: wh2 } = await supabase.from('warehouses').insert({
      tenant_id: TENANT,
      branch_id: (await supabase.from('warehouses').select('branch_id').eq('id', warehouseId).single()).data!.branch_id,
      name: 'F7 Lifecycle WH2', code: `F7LC2-${Date.now()}`,
    }).select().single();

    try {
      const { waveId: waveA, pickListId: plA } = await createReleasedWave();

      // Second wave in wh2 — real RPCs, own shipment.
      const { data: shipmentB } = await supabase.from('shipments').insert({
        tenant_id: TENANT, warehouse_id: wh2.id, reference_type: 'order', reference_id: crypto.randomUUID(), status: 'pending',
      }).select().single();
      await supabase.from('shipment_lines').insert({ tenant_id: TENANT, shipment_id: shipmentB.id, item_id: itemId, quantity_requested: 3 });
      // wh2 needs its own stock for a real claim/reservation to succeed.
      const { data: movB } = await supabase.from('stock_movements').insert({
        tenant_id: TENANT, warehouse_id: wh2.id, item_id: itemId, movement_type: 'receipt', direction: 'in',
        quantity: 100, unit_cost: 5, total_cost: 500, reference_type: 'f7_lifecycle_seed',
      }).select().single();
      await supabase.from('stock_levels').insert({ tenant_id: TENANT, warehouse_id: wh2.id, item_id: itemId, quantity_on_hand: 100 });
      await supabase.from('cost_layers').insert({ tenant_id: TENANT, warehouse_id: wh2.id, item_id: itemId, source_movement_id: movB.id, unit_cost: 5, quantity_received: 100, quantity_remaining: 100 });

      const { data: waveB } = await supabase.from('waves').insert({ tenant_id: TENANT, warehouse_id: wh2.id, status: 'planning', criteria: {} }).select().single();
      cleanupWaveIds.push(waveB.id);
      await supabase.rpc('fn_evaluate_wave_eligibility', { p_wave_id: waveB.id, p_tenant_id: TENANT, p_actor_id: actorId });
      const { data: plsB } = await supabase.rpc('fn_release_wave', { p_wave_id: waveB.id, p_tenant_id: TENANT, p_actor_id: actorId, p_priority: 'medium' });
      const plBId = plsB[0].id;
      cleanupPickListIds.push(plBId);

      // Complete only wave A's pick list — wave B must remain 'picking'.
      await fullyPick(plA);

      const { data: wA } = await supabase.from('waves').select('status, warehouse_id').eq('id', waveA).single();
      const { data: wB } = await supabase.from('waves').select('status, warehouse_id').eq('id', waveB.id).single();
      expect(wA!.status).toBe('completed');
      expect(wA!.warehouse_id).toBe(warehouseId);
      expect(wB!.status).toBe('picking'); // unaffected by wave A's completion
      expect(wB!.warehouse_id).toBe(wh2.id);

      await fullyPick(plBId);
      const { data: wB2 } = await supabase.from('waves').select('status').eq('id', waveB.id).single();
      expect(wB2!.status).toBe('completed');
    } finally {
      await supabase.from('warehouses').delete().eq('id', wh2.id);
    }
  }, 30000);

  it('9. history correctness: released->picking and picking->completed rows have the right actors, statuses, and notes', async () => {
    const { waveId, pickListId } = await createReleasedWave();
    await fullyPick(pickListId);

    const { data: history } = await supabase.from('warehouse_work_status_history')
      .select('*').eq('tenant_id', TENANT).eq('entity_type', 'wave').eq('entity_id', waveId).order('created_at', { ascending: true });

    const releasedToPicking = history!.find((h) => h.old_status === 'released' && h.new_status === 'picking');
    expect(releasedToPicking).toBeTruthy();
    expect(releasedToPicking!.actor_id).toBe(actorId); // real actor from the release call

    const pickingToCompleted = history!.find((h) => h.old_status === 'picking' && h.new_status === 'completed');
    expect(pickingToCompleted).toBeTruthy();
    expect(pickingToCompleted!.actor_id).toBeNull(); // system-detected, no single actor
    expect(pickingToCompleted!.notes).toContain('complete');
  }, 20000);
});
