/**
 * Regression suite for Inventory #7 / 7-6 — Wave Claim + Release
 * (migration 237). Runs directly against the real Supabase project, same
 * pattern as every other regression suite in this directory. Not wired
 * into CI — run via `npm test`.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const TENANT = '9bcd3369-d664-47c8-b297-3bc9b429aacf'; // Sefay Demo

describe('Wave Claim + Release (Inventory #7 / 7-6)', () => {
  let supabase: SupabaseClient;
  let warehouseId: string;
  let locationId: string;
  let itemId: string;
  let actorId: string;
  const cleanupItemIds: string[] = [];
  const cleanupLocationIds: string[] = [];
  const cleanupShipmentIds: string[] = [];
  const cleanupWaveIds: string[] = [];

  async function createShipment(qty = 5) {
    const { data: shipment, error: shErr } = await supabase
      .from('shipments')
      .insert({
        tenant_id: TENANT,
        warehouse_id: warehouseId,
        reference_type: 'order',
        reference_id: crypto.randomUUID(),
        status: 'pending',
      })
      .select()
      .single();
    if (shErr) throw shErr;
    cleanupShipmentIds.push(shipment.id);

    const { error: slErr } = await supabase.from('shipment_lines').insert({
      tenant_id: TENANT,
      shipment_id: shipment.id,
      item_id: itemId,
      location_id: locationId,
      quantity_requested: qty,
    });
    if (slErr) throw slErr;
    return shipment.id as string;
  }

  async function createWave(criteria: Record<string, unknown> = {}) {
    const { data: wave, error } = await supabase
      .from('waves')
      .insert({
        tenant_id: TENANT,
        warehouse_id: warehouseId,
        criteria,
        created_by: actorId,
      })
      .select()
      .single();
    if (error) throw error;
    cleanupWaveIds.push(wave.id);
    return wave.id as string;
  }

  async function evaluate(waveId: string) {
    const { error } = await supabase.rpc('fn_evaluate_wave_eligibility', {
      p_wave_id: waveId,
      p_tenant_id: TENANT,
      p_actor_id: actorId,
    });
    if (error) throw error;
  }

  beforeAll(async () => {
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    );

    const { data: wh } = await supabase
      .from('warehouses')
      .select('id')
      .eq('tenant_id', TENANT)
      .limit(1);
    warehouseId = wh[0].id as string;

    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('tenant_id', TENANT)
      .limit(1);
    actorId = user[0].id as string;

    const { data: item } = await supabase
      .from('items')
      .insert({
        tenant_id: TENANT,
        name: '7.6 Wave Test Item',
        type: 'product',
        operation_type: 'sell',
        price: 5,
        is_active: true,
      })
      .select()
      .single();
    itemId = item.id;
    cleanupItemIds.push(itemId);

    const { data: loc } = await supabase
      .from('warehouse_locations')
      .insert({
        tenant_id: TENANT,
        warehouse_id: warehouseId,
        code: `W76-${Date.now()}`,
        name: '7.6 Storage Test',
        location_purpose: 'storage',
      })
      .select()
      .single();
    locationId = loc.id;
    cleanupLocationIds.push(locationId);

    // Enough stock for every reservation this suite will attempt. Seeded
    // at location_id=NULL to match fn_create_reservation's own lookup
    // (it always locks the stock_levels row at location_id=NULL — see
    // fn_create_pick_list/fn_create_zone_pick_lists_for_shipments, both
    // of which call fn_create_reservation with a hardcoded NULL location
    // regardless of the pick_list_lines row's own location_id).
    const { error: movErr } = await supabase.rpc('fn_apply_stock_movement', {
      p_tenant_id: TENANT,
      p_warehouse_id: warehouseId,
      p_location_id: null,
      p_item_id: itemId,
      p_variant_id: null,
      p_batch_id: null,
      p_movement_type: 'receipt',
      p_direction: 'in',
      p_quantity: 1000,
      p_unit_cost: 1,
      p_reference_type: 'test_seed',
      p_reference_id: crypto.randomUUID(),
      p_created_by: actorId,
    });
    if (movErr) throw movErr;
  });

  afterAll(async () => {
    // Best-effort cleanup, reverse dependency order. Generous timeout —
    // this suite creates a wave/shipment per scenario across 12 tests.
    for (const id of cleanupWaveIds) {
      await supabase.from('wave_shipments').delete().eq('wave_id', id);
      await supabase
        .from('pick_list_lines')
        .delete()
        .in(
          'pick_list_id',
          (
            await supabase.from('pick_lists').select('id').eq('wave_id', id)
          ).data?.map((r) => r.id) ?? [],
        );
      await supabase
        .from('pick_list_shipments')
        .delete()
        .in(
          'pick_list_id',
          (
            await supabase.from('pick_lists').select('id').eq('wave_id', id)
          ).data?.map((r) => r.id) ?? [],
        );
      await supabase.from('pick_lists').delete().eq('wave_id', id);
      await supabase
        .from('warehouse_work_status_history')
        .delete()
        .eq('entity_type', 'wave')
        .eq('entity_id', id);
    }
    await supabase.from('waves').delete().in('id', cleanupWaveIds);
    for (const id of cleanupShipmentIds) {
      await supabase.from('shipment_lines').delete().eq('shipment_id', id);
    }
    await supabase.from('shipments').delete().in('id', cleanupShipmentIds);
    await supabase
      .from('warehouse_locations')
      .delete()
      .in('id', cleanupLocationIds);
    await supabase.from('items').delete().in('id', cleanupItemIds);
  }, 60000);

  it('1. happy path: release claims the shipment, creates one wave pick list, reservation, history, audit', async () => {
    const shipmentId = await createShipment(5);
    const waveId = await createWave();
    await evaluate(waveId);

    const { data: pickLists, error } = await supabase.rpc('fn_release_wave', {
      p_wave_id: waveId,
      p_tenant_id: TENANT,
      p_actor_id: actorId,
    });
    expect(error).toBeNull();
    expect(pickLists).toHaveLength(1);
    expect(pickLists[0].strategy).toBe('wave');
    expect(pickLists[0].wave_id).toBe(waveId);
    expect(pickLists[0].zone_location_id).toBeNull();

    const { data: shipment } = await supabase
      .from('shipments')
      .select('*')
      .eq('id', shipmentId)
      .single();
    expect(shipment.status).toBe('picking');
    expect(shipment.claimed_by_wave_id).toBe(waveId);
    expect(shipment.claimed_at).not.toBeNull();

    const { data: pls } = await supabase
      .from('pick_list_shipments')
      .select('*')
      .eq('pick_list_id', pickLists[0].id);
    expect(pls).toHaveLength(1);
    expect(pls[0].shipment_id).toBe(shipmentId);

    const { data: line } = await supabase
      .from('shipment_lines')
      .select('*')
      .eq('shipment_id', shipmentId)
      .single();
    expect(line.reservation_id).not.toBeNull();

    const { data: wave } = await supabase
      .from('waves')
      .select('*')
      .eq('id', waveId)
      .single();
    // F7 lifecycle gap closure (migration 248): released -> picking now
    // happens synchronously in the same fn_release_wave transaction,
    // since the pick list just created above is already 'in_progress'.
    expect(wave.status).toBe('picking');
    expect(wave.released_at).not.toBeNull();

    const { data: history } = await supabase
      .from('warehouse_work_status_history')
      .select('*')
      .eq('entity_type', 'wave')
      .eq('entity_id', waveId)
      .order('created_at', { ascending: true });
    const statuses = history.map((h) => `${h.old_status}->${h.new_status}`);
    expect(statuses).toContain('reviewing->released');
    expect(statuses).toContain('released->picking');

    const { data: pickListHistory } = await supabase
      .from('warehouse_work_status_history')
      .select('*')
      .eq('entity_type', 'pick_list')
      .eq('entity_id', pickLists[0].id);
    expect(pickListHistory.length).toBeGreaterThan(0);
  }, 20000);

  it('2. idempotent release: repeated sequential release returns the same pick list, no duplicates', async () => {
    await createShipment(3);
    const waveId = await createWave();
    await evaluate(waveId);

    const { data: first } = await supabase.rpc('fn_release_wave', {
      p_wave_id: waveId,
      p_tenant_id: TENANT,
      p_actor_id: actorId,
    });
    const { data: second } = await supabase.rpc('fn_release_wave', {
      p_wave_id: waveId,
      p_tenant_id: TENANT,
      p_actor_id: actorId,
    });

    expect(second).toHaveLength(1);
    expect(second[0].id).toBe(first[0].id);

    const { data: allPickLists } = await supabase
      .from('pick_lists')
      .select('id')
      .eq('wave_id', waveId);
    expect(allPickLists).toHaveLength(1);

    const { count } = await supabase
      .from('warehouse_work_status_history')
      .select('*', { count: 'exact', head: true })
      .eq('entity_type', 'wave')
      .eq('entity_id', waveId)
      .eq('new_status', 'released');
    expect(count).toBe(1);
  }, 20000);

  it('3. concurrent release of the same wave: exactly one pick list is created, no duplicate claim', async () => {
    await createShipment(4);
    const waveId = await createWave();
    await evaluate(waveId);

    const [r1, r2] = await Promise.all([
      supabase.rpc('fn_release_wave', {
        p_wave_id: waveId,
        p_tenant_id: TENANT,
        p_actor_id: actorId,
      }),
      supabase.rpc('fn_release_wave', {
        p_wave_id: waveId,
        p_tenant_id: TENANT,
        p_actor_id: actorId,
      }),
    ]);

    // Both calls succeed (one performs the real release, the other takes
    // the idempotent no-op path once it acquires the row lock second) —
    // neither may error, and both must agree on the same pick list.
    expect(r1.error).toBeNull();
    expect(r2.error).toBeNull();
    expect(r1.data[0].id).toBe(r2.data[0].id);

    const { data: allPickLists } = await supabase
      .from('pick_lists')
      .select('id')
      .eq('wave_id', waveId);
    expect(allPickLists).toHaveLength(1);
  }, 20000);

  it('4. two waves racing for the same shipment: only one claims it, the loser records an exclusion reason', async () => {
    const shipmentId = await createShipment(2);
    const waveA = await createWave();
    const waveB = await createWave();
    await evaluate(waveA);
    await evaluate(waveB);

    // Both waves evaluated the same pending shipment as included (no
    // criteria narrows it) — confirm the race is real before releasing.
    const { data: wsA } = await supabase
      .from('wave_shipments')
      .select('*')
      .eq('wave_id', waveA)
      .eq('shipment_id', shipmentId)
      .single();
    const { data: wsB } = await supabase
      .from('wave_shipments')
      .select('*')
      .eq('wave_id', waveB)
      .eq('shipment_id', shipmentId)
      .single();
    expect(wsA.included_reason).not.toBeNull();
    expect(wsB.included_reason).not.toBeNull();

    const [rA, rB] = await Promise.allSettled([
      supabase.rpc('fn_release_wave', {
        p_wave_id: waveA,
        p_tenant_id: TENANT,
        p_actor_id: actorId,
      }),
      supabase.rpc('fn_release_wave', {
        p_wave_id: waveB,
        p_tenant_id: TENANT,
        p_actor_id: actorId,
      }),
    ]);

    // Exactly one of the two waves actually claims the shipment (the
    // other's release either fails outright with
    // WAVE_NO_ELIGIBLE_SHIPMENTS if this was its only shipment, or
    // succeeds while correctly excluding this one — both are valid
    // "loser" outcomes; what must NEVER happen is both waves claiming it).
    const { data: shipment } = await supabase
      .from('shipments')
      .select('claimed_by_wave_id')
      .eq('id', shipmentId)
      .single();
    expect([waveA, waveB]).toContain(shipment.claimed_by_wave_id);

    const winnerId = shipment.claimed_by_wave_id as string;
    const loserId = winnerId === waveA ? waveB : waveA;

    const { data: loserWs } = await supabase
      .from('wave_shipments')
      .select('*')
      .eq('wave_id', loserId)
      .eq('shipment_id', shipmentId)
      .single();
    expect(loserWs.included_reason).toBeNull();
    expect(loserWs.excluded_reason).not.toBeNull();
    expect(loserWs.excluded_reason.reason).toBe('claim_failed_at_release');
    expect(loserWs.excluded_reason.claimed_by_other_wave_id).toBe(winnerId);

    // The loser had exactly one candidate shipment, which it lost. At the
    // SQL level (fn_release_wave, called directly here) this is NOT an
    // error — it returns zero rows, with the exclusion bookkeeping above
    // already durably committed, and the wave itself untouched. (The
    // service layer, WmsService.releaseWave, is what turns an empty
    // result into a WAVE_NO_ELIGIBLE_SHIPMENTS error for the HTTP
    // caller — see the real-HTTP concurrency test for that layer.)
    const loserResult = winnerId === waveA ? rB : rA;
    expect(loserResult.status).toBe('fulfilled');
    if (loserResult.status === 'fulfilled') {
      expect(loserResult.value.error).toBeNull();
      expect(loserResult.value.data).toEqual([]);
    }
    const { data: loserWave } = await supabase
      .from('waves')
      .select('status, released_at')
      .eq('id', loserId)
      .single();
    expect(loserWave.status).toBe('reviewing');
    expect(loserWave.released_at).toBeNull();

    const { data: loserPickLists } = await supabase
      .from('pick_lists')
      .select('id')
      .eq('wave_id', loserId);
    expect(loserPickLists).toHaveLength(0);
  }, 20000);

  it('5. shipment claimed elsewhere before release: excluded with a concrete reason, release still succeeds for the rest', async () => {
    const claimedElsewhere = await createShipment(1);
    const stillEligible = await createShipment(1);
    const waveId = await createWave();
    await evaluate(waveId);

    // Simulate an external claim between evaluation and release — a
    // different (real) wave claims it first.
    const otherWaveId = await createWave();
    await evaluate(otherWaveId); // would include claimedElsewhere and stillEligible too — release only claimedElsewhere manually to isolate the scenario
    await supabase
      .from('shipments')
      .update({
        claimed_by_wave_id: otherWaveId,
        claimed_at: new Date().toISOString(),
        status: 'picking',
      })
      .eq('id', claimedElsewhere);

    const { data: pickLists, error } = await supabase.rpc('fn_release_wave', {
      p_wave_id: waveId,
      p_tenant_id: TENANT,
      p_actor_id: actorId,
    });
    expect(error).toBeNull();
    expect(pickLists).toHaveLength(1);

    const { data: pls } = await supabase
      .from('pick_list_shipments')
      .select('shipment_id')
      .eq('pick_list_id', pickLists[0].id);
    expect(pls.map((r) => r.shipment_id)).toEqual([stillEligible]);

    const { data: ws } = await supabase
      .from('wave_shipments')
      .select('*')
      .eq('wave_id', waveId)
      .eq('shipment_id', claimedElsewhere)
      .single();
    expect(ws.included_reason).toBeNull();
    expect(ws.excluded_reason.reason).toBe('claim_failed_at_release');
  }, 20000);

  it('6. release rejected: wave not evaluated (still planning)', async () => {
    const waveId = await createWave();
    const { error } = await supabase.rpc('fn_release_wave', {
      p_wave_id: waveId,
      p_tenant_id: TENANT,
      p_actor_id: actorId,
    });
    expect(error).not.toBeNull();
    expect(error.message).toContain('WAVE_NOT_READY');
  });

  it('7. release with zero eligible shipments: SQL layer returns empty (no error), wave stays reviewing', async () => {
    // Use an impossible route filter so nothing is included even if
    // other tests' shipments are still pending in this shared warehouse.
    const isolatedWaveId = await createWave({
      route: `impossible-route-${Date.now()}`,
    });
    await evaluate(isolatedWaveId);

    const { data, error } = await supabase.rpc('fn_release_wave', {
      p_wave_id: isolatedWaveId,
      p_tenant_id: TENANT,
      p_actor_id: actorId,
    });
    expect(error).toBeNull();
    expect(data).toEqual([]);

    const { data: wave } = await supabase
      .from('waves')
      .select('status, released_at')
      .eq('id', isolatedWaveId)
      .single();
    expect(wave.status).toBe('reviewing');
    expect(wave.released_at).toBeNull();
  });

  it('8. cancellation: wave can be cancelled before release, and release is then rejected', async () => {
    const waveId = await createWave();
    const { data: cancelled, error: cancelErr } = await supabase.rpc(
      'fn_cancel_wave',
      {
        p_wave_id: waveId,
        p_tenant_id: TENANT,
        p_reason: 'test cancellation',
        p_actor_id: actorId,
      },
    );
    expect(cancelErr).toBeNull();
    expect(cancelled.status).toBe('cancelled');

    const { error: releaseErr } = await supabase.rpc('fn_release_wave', {
      p_wave_id: waveId,
      p_tenant_id: TENANT,
      p_actor_id: actorId,
    });
    expect(releaseErr).not.toBeNull();
    expect(releaseErr.message).toContain('WAVE_CANCELLED');
  });

  it('9. cancellation rejected after release', async () => {
    await createShipment(1);
    const waveId = await createWave();
    await evaluate(waveId);
    await supabase.rpc('fn_release_wave', {
      p_wave_id: waveId,
      p_tenant_id: TENANT,
      p_actor_id: actorId,
    });

    const { error } = await supabase.rpc('fn_cancel_wave', {
      p_wave_id: waveId,
      p_tenant_id: TENANT,
      p_reason: 'too late',
      p_actor_id: actorId,
    });
    expect(error).not.toBeNull();
    expect(error.message).toContain('WAVE_CANNOT_CANCEL');
  });

  it('10. cancelling the wave pick list frees its shipment for reclaim by a new wave', async () => {
    const shipmentId = await createShipment(1);
    const waveId = await createWave();
    await evaluate(waveId);
    const { data: pickLists } = await supabase.rpc('fn_release_wave', {
      p_wave_id: waveId,
      p_tenant_id: TENANT,
      p_actor_id: actorId,
    });

    const { error: cancelErr } = await supabase.rpc('fn_cancel_pick_list', {
      p_pick_list_id: pickLists[0].id,
      p_tenant_id: TENANT,
      p_reason: 'test cancel pick list',
      p_actor_id: actorId,
    });
    expect(cancelErr).toBeNull();

    const { data: shipment } = await supabase
      .from('shipments')
      .select('*')
      .eq('id', shipmentId)
      .single();
    expect(shipment.status).toBe('pending');
    expect(shipment.claimed_by_wave_id).toBeNull();
    expect(shipment.claimed_at).toBeNull();

    // A fresh wave can now claim it.
    const waveId2 = await createWave();
    await evaluate(waveId2);
    const { data: pickLists2, error } = await supabase.rpc('fn_release_wave', {
      p_wave_id: waveId2,
      p_tenant_id: TENANT,
      p_actor_id: actorId,
    });
    expect(error).toBeNull();
    const { data: pls2 } = await supabase
      .from('pick_list_shipments')
      .select('shipment_id')
      .eq('pick_list_id', pickLists2[0].id);
    expect(pls2.map((r) => r.shipment_id)).toContain(shipmentId);
  }, 20000);

  it('11. wrong tenant is rejected (tenant isolation)', async () => {
    const waveId = await createWave();
    const { error } = await supabase.rpc('fn_release_wave', {
      p_wave_id: waveId,
      p_tenant_id: '00000000-0000-0000-0000-000000000000',
      p_actor_id: actorId,
    });
    expect(error).not.toBeNull();
    expect(error.message).toContain('not found');
  });

  it('12. wave not found', async () => {
    const { error } = await supabase.rpc('fn_release_wave', {
      p_wave_id: '00000000-0000-0000-0000-000000000000',
      p_tenant_id: TENANT,
      p_actor_id: actorId,
    });
    expect(error).not.toBeNull();
    expect(error.message).toContain('not found');
  });
});
