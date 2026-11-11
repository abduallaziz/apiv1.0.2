/**
 * Regression suite for Inventory #7 / 7-7 — Exception Handling Primitives
 * (migration 239). Runs directly against the real Supabase project, same
 * pattern as every other regression suite in this directory. Not wired
 * into CI — run via `npm test`.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const TENANT = '9bcd3369-d664-47c8-b297-3bc9b429aacf'; // Sefay Demo

describe('Exception Handling Primitives (Inventory #7 / 7-7)', () => {
  let supabase: SupabaseClient;
  let warehouseId: string;
  let locationId: string;
  let itemId: string;
  let actorId: string;
  const cleanupItemIds: string[] = [];
  const cleanupLocationIds: string[] = [];
  const cleanupShipmentIds: string[] = [];
  const cleanupPickListIds: string[] = [];

  // Creates a real 'picking' shipment (via fn_create_pick_list, reusing
  // 7-2 exactly — never a raw status='picking' insert) with a real
  // reservation covering `qty`, optionally partially picked via
  // fn_confirm_pick so tests can exercise the "outstanding" pool.
  async function createPickingShipment(qty: number, alreadyPicked = 0) {
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

    const { data: pickList, error: plErr } = await supabase.rpc(
      'fn_create_pick_list',
      {
        p_tenant_id: TENANT,
        p_warehouse_id: warehouseId,
        p_shipment_ids: [shipment.id],
        p_strategy: 'single',
        p_zone_location_id: null,
        p_actor_id: actorId,
        p_priority: 'medium',
      },
    );
    if (plErr) throw plErr;
    cleanupPickListIds.push(pickList.id);

    if (alreadyPicked > 0) {
      const { data: pll } = await supabase
        .from('pick_list_lines')
        .select('id')
        .eq('pick_list_id', pickList.id)
        .single();
      const { error: confirmErr } = await supabase.rpc('fn_confirm_pick', {
        p_pick_list_line_id: pll.id,
        p_quantity: alreadyPicked,
        p_actor_id: actorId,
      });
      if (confirmErr) throw confirmErr;
    }

    // A single query by shipment_id covers what two separate selects (one
    // by shipment_id purely to learn the row's own id, one by id to read
    // its refreshed state) did before — this fixture creates exactly one
    // shipment_line per shipment, so shipment_id alone is already a unique
    // key here. Removes one of createPickingShipment's real network
    // round-trips to the hosted PostgREST API, used by all 13 tests in
    // this file, each of which runs within Jest's default 5000ms test
    // timeout — this was found to be the root cause of an intermittent
    // Test 7 timeout under full-suite load (measured ~300-900ms per
    // round-trip; 7 sequential round-trips per call left near-zero
    // margin).
    const { data: refreshedLine } = await supabase
      .from('shipment_lines')
      .select('*')
      .eq('shipment_id', shipment.id)
      .single();

    return {
      shipmentId: shipment.id,
      pickListId: pickList.id,
      lineId: refreshedLine.id,
      line: refreshedLine,
    };
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
        name: '7.7 Exception Test Item',
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
        code: `W77-${Date.now()}`,
        name: '7.7 Storage Test',
        location_purpose: 'storage',
      })
      .select()
      .single();
    locationId = loc.id;
    cleanupLocationIds.push(locationId);

    const { error: movErr } = await supabase.rpc('fn_apply_stock_movement', {
      p_tenant_id: TENANT,
      p_warehouse_id: warehouseId,
      p_location_id: null,
      p_item_id: itemId,
      p_variant_id: null,
      p_batch_id: null,
      p_movement_type: 'receipt',
      p_direction: 'in',
      p_quantity: 100000,
      p_unit_cost: 2,
      p_reference_type: 'test_seed',
      p_reference_id: crypto.randomUUID(),
      p_created_by: actorId,
    });
    if (movErr) throw movErr;

    // fn_apply_stock_movement's 'receipt'/'in' branch increments
    // quantity_on_hand only — it does not populate cost_layers (that's
    // a separate goods-receipt-flow responsibility elsewhere in the
    // codebase). fn_record_lost_item's real FIFO cost-layer consumption
    // needs an actual layer to draw from, so one is seeded directly here.
    const { error: layerErr } = await supabase.from('cost_layers').insert({
      tenant_id: TENANT,
      warehouse_id: warehouseId,
      item_id: itemId,
      unit_cost: 2,
      quantity_received: 100000,
      quantity_remaining: 100000,
    });
    if (layerErr) throw layerErr;
  }, 30000);

  afterAll(async () => {
    await supabase
      .from('warehouse_exceptions')
      .delete()
      .eq('tenant_id', TENANT)
      .in(
        'entity_id',
        cleanupShipmentIds.length
          ? cleanupShipmentIds
          : ['00000000-0000-0000-0000-000000000000'],
      );
    await supabase
      .from('warehouse_work_status_history')
      .delete()
      .eq('tenant_id', TENANT)
      .in('entity_id', [...cleanupShipmentIds, ...cleanupPickListIds]);
    await supabase
      .from('pick_list_lines')
      .delete()
      .in('pick_list_id', cleanupPickListIds);
    await supabase
      .from('pick_list_shipments')
      .delete()
      .in('pick_list_id', cleanupPickListIds);
    await supabase.from('pick_lists').delete().in('id', cleanupPickListIds);
    await supabase
      .from('shipment_lines')
      .delete()
      .in('shipment_id', cleanupShipmentIds);
    await supabase.from('shipments').delete().in('id', cleanupShipmentIds);
    await supabase
      .from('stock_reservations')
      .delete()
      .eq('tenant_id', TENANT)
      .eq('reference_type', 'pick_list_line');
    await supabase
      .from('stock_movements')
      .delete()
      .eq('tenant_id', TENANT)
      .in('item_id', cleanupItemIds);
    await supabase
      .from('cost_layers')
      .delete()
      .eq('tenant_id', TENANT)
      .in('item_id', cleanupItemIds);
    await supabase
      .from('stock_levels')
      .delete()
      .eq('tenant_id', TENANT)
      .in('item_id', cleanupItemIds);
    await supabase
      .from('warehouse_locations')
      .delete()
      .in('id', cleanupLocationIds);
    await supabase.from('items').delete().in('id', cleanupItemIds);
  }, 60000);

  it('1. short pick: requested = picked + short, reservation reduced, exception recorded, shipment settles', async () => {
    const { shipmentId, lineId, line } = await createPickingShipment(10, 6);
    expect(line.quantity_picked).toBe(6);
    const reservationId = line.reservation_id;

    const { data: reservationBefore } = await supabase
      .from('stock_reservations')
      .select('quantity')
      .eq('id', reservationId)
      .single();
    expect(Number(reservationBefore.quantity)).toBe(10);

    const { data: exception, error } = await supabase.rpc(
      'fn_record_short_pick',
      {
        p_shipment_line_id: lineId,
        p_tenant_id: TENANT,
        p_reason: 'shelf empty',
        p_actor_id: actorId,
      },
    );
    expect(error).toBeNull();
    expect(exception.exception_type).toBe('short_pick');
    expect(Number(exception.affected_quantity)).toBe(4);
    expect(exception.resolution).toBe('backordered');
    expect(exception.status).toBe('resolved');

    const { data: lineAfter } = await supabase
      .from('shipment_lines')
      .select('*')
      .eq('id', lineId)
      .single();
    expect(Number(lineAfter.quantity_requested)).toBe(10);
    expect(Number(lineAfter.quantity_picked)).toBe(6);
    expect(Number(lineAfter.quantity_exception)).toBe(4);
    expect(
      Number(lineAfter.quantity_picked) + Number(lineAfter.quantity_exception),
    ).toBe(Number(lineAfter.quantity_requested));

    const { data: reservationAfter } = await supabase
      .from('stock_reservations')
      .select('quantity, status')
      .eq('id', reservationId)
      .single();
    expect(Number(reservationAfter.quantity)).toBe(6);
    expect(reservationAfter.status).toBe('active');

    const { data: shipmentAfter } = await supabase
      .from('shipments')
      .select('status')
      .eq('id', shipmentId)
      .single();
    expect(shipmentAfter.status).toBe('picked');

    const { data: history } = await supabase
      .from('warehouse_work_status_history')
      .select('*')
      .eq('entity_type', 'shipment')
      .eq('entity_id', shipmentId);
    expect(history.some((h) => h.new_status === 'picked')).toBe(true);
  }, 30_000);

  it('2. short pick idempotency: finalizing an already-settled line raises NOT_SHORT, no duplicate exception', async () => {
    // Fully picking this line makes fn_confirm_pick's own pre-existing
    // completion check (unmodified 7-2 logic) flip the shipment straight
    // to 'picked' — force it back to 'picking' so THIS test isolates the
    // NOT_SHORT check specifically, rather than the (also-correct, but
    // different) status gate.
    const { shipmentId, lineId } = await createPickingShipment(5, 5);
    await supabase
      .from('shipments')
      .update({ status: 'picking' })
      .eq('id', shipmentId);

    const { error } = await supabase.rpc('fn_record_short_pick', {
      p_shipment_line_id: lineId,
      p_tenant_id: TENANT,
      p_reason: 'nothing outstanding',
      p_actor_id: actorId,
    });
    expect(error).not.toBeNull();
    expect(error.message).toContain('NOT_SHORT');
  }, 30_000);

  it('3. concurrent short-pick finalization: only one succeeds, no negative reservation, no duplicate quantity_exception', async () => {
    const { lineId } = await createPickingShipment(8, 3);

    const [r1, r2] = await Promise.allSettled([
      supabase.rpc('fn_record_short_pick', {
        p_shipment_line_id: lineId,
        p_tenant_id: TENANT,
        p_reason: 'race A',
        p_actor_id: actorId,
      }),
      supabase.rpc('fn_record_short_pick', {
        p_shipment_line_id: lineId,
        p_tenant_id: TENANT,
        p_reason: 'race B',
        p_actor_id: actorId,
      }),
    ]);

    const results = [r1, r2].map((r) =>
      r.status === 'fulfilled'
        ? r.value
        : { error: { message: String(r.reason) } },
    );
    const successes = results.filter((r) => !r.error);
    const failures = results.filter((r) => r.error);
    // Row-level FOR UPDATE locking on shipment_lines serializes the two
    // calls — the loser is rejected either with NOT_SHORT (nothing left
    // outstanding) or, for a single-line shipment like this one, "not in
    // a pickable state" (the winner's own settle-check already advanced
    // the shipment to 'picked' before the loser's turn) — both are the
    // same underlying guarantee (no double-application), just surfaced at
    // different checks depending on timing. What must never happen is
    // both succeeding.
    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);
    expect(failures[0].error.message).toMatch(
      /NOT_SHORT|not in a pickable state/,
    );

    const { data: lineAfter } = await supabase
      .from('shipment_lines')
      .select('quantity_exception')
      .eq('id', lineId)
      .single();
    expect(Number(lineAfter.quantity_exception)).toBe(5);

    const { count } = await supabase
      .from('warehouse_exceptions')
      .select('*', { count: 'exact', head: true })
      .eq('entity_type', 'shipment_line')
      .eq('entity_id', lineId)
      .eq('exception_type', 'short_pick');
    expect(count).toBe(1);
  }, 30_000);

  it('4. damaged: real reclassification into quantity_damaged, on_hand unaffected, reservation reduced', async () => {
    const { lineId } = await createPickingShipment(6, 2);

    const { data: levelBefore } = await supabase
      .from('stock_levels')
      .select('quantity_on_hand, quantity_damaged')
      .eq('tenant_id', TENANT)
      .eq('warehouse_id', warehouseId)
      .eq('item_id', itemId)
      .is('location_id', null)
      .single();

    const { data: exception, error } = await supabase.rpc('fn_record_damage', {
      p_shipment_line_id: lineId,
      p_tenant_id: TENANT,
      p_quantity: 4,
      p_reason: 'box crushed in transit',
      p_actor_id: actorId,
    });
    expect(error).toBeNull();
    expect(exception.exception_type).toBe('damaged');
    expect(Number(exception.affected_quantity)).toBe(4);
    expect(exception.stock_movement_id).not.toBeNull();

    const { data: levelAfter } = await supabase
      .from('stock_levels')
      .select('quantity_on_hand, quantity_damaged')
      .eq('tenant_id', TENANT)
      .eq('warehouse_id', warehouseId)
      .eq('item_id', itemId)
      .is('location_id', null)
      .single();
    // on_hand unchanged (damaged stays physically present); damaged
    // bucket grew by exactly the reported quantity.
    expect(Number(levelAfter.quantity_on_hand)).toBe(
      Number(levelBefore.quantity_on_hand),
    );
    expect(Number(levelAfter.quantity_damaged)).toBe(
      Number(levelBefore.quantity_damaged) + 4,
    );

    const { data: movement } = await supabase
      .from('stock_movements')
      .select('*')
      .eq('id', exception.stock_movement_id)
      .single();
    expect(movement.movement_type).toBe('damage');
    expect(Number(movement.quantity)).toBe(4);
  }, 30_000);

  it('5. damage exceeding outstanding is rejected', async () => {
    const { lineId } = await createPickingShipment(5, 4);
    const { error } = await supabase.rpc('fn_record_damage', {
      p_shipment_line_id: lineId,
      p_tenant_id: TENANT,
      p_quantity: 2,
      p_reason: 'too much',
      p_actor_id: actorId,
    });
    expect(error).not.toBeNull();
    expect(error.message).toContain('DAMAGE_EXCEEDS_OUTSTANDING');
  }, 30_000);

  it('6. lost item: real write-off — quantity_on_hand decreases, cost layer consumed, movement_type=lost', async () => {
    const { lineId } = await createPickingShipment(6, 1);

    const { data: levelBefore } = await supabase
      .from('stock_levels')
      .select('quantity_on_hand')
      .eq('tenant_id', TENANT)
      .eq('warehouse_id', warehouseId)
      .eq('item_id', itemId)
      .is('location_id', null)
      .single();

    const { data: exception, error } = await supabase.rpc(
      'fn_record_lost_item',
      {
        p_shipment_line_id: lineId,
        p_tenant_id: TENANT,
        p_quantity: 3,
        p_reason: 'confirmed missing after cycle count',
        p_actor_id: actorId,
      },
    );
    expect(error).toBeNull();
    expect(exception.exception_type).toBe('lost');
    expect(exception.resolution).toBe('written_off');
    expect(exception.stock_movement_id).not.toBeNull();

    const { data: levelAfter } = await supabase
      .from('stock_levels')
      .select('quantity_on_hand')
      .eq('tenant_id', TENANT)
      .eq('warehouse_id', warehouseId)
      .eq('item_id', itemId)
      .is('location_id', null)
      .single();
    // Real, immediate write-off — on_hand actually decreases (unlike damage).
    expect(Number(levelAfter.quantity_on_hand)).toBe(
      Number(levelBefore.quantity_on_hand) - 3,
    );

    const { data: movement } = await supabase
      .from('stock_movements')
      .select('*')
      .eq('id', exception.stock_movement_id)
      .single();
    expect(movement.movement_type).toBe('lost');
    expect(movement.direction).toBe('out');
    expect(Number(movement.quantity)).toBe(3);
    expect(Number(movement.unit_cost)).toBeGreaterThan(0);
    expect(
      Number(movement.before_quantity) - Number(movement.after_quantity),
    ).toBe(3);
  }, 30_000);

  it('7. lost item exceeding outstanding is rejected, no partial write-off leaks', async () => {
    const { lineId } = await createPickingShipment(4, 3);
    const { data: levelBefore } = await supabase
      .from('stock_levels')
      .select('quantity_on_hand')
      .eq('tenant_id', TENANT)
      .eq('warehouse_id', warehouseId)
      .eq('item_id', itemId)
      .is('location_id', null)
      .single();

    const { error } = await supabase.rpc('fn_record_lost_item', {
      p_shipment_line_id: lineId,
      p_tenant_id: TENANT,
      p_quantity: 5,
      p_reason: 'too much',
      p_actor_id: actorId,
    });
    expect(error).not.toBeNull();
    expect(error.message).toContain('LOST_EXCEEDS_OUTSTANDING');

    const { data: levelAfter } = await supabase
      .from('stock_levels')
      .select('quantity_on_hand')
      .eq('tenant_id', TENANT)
      .eq('warehouse_id', warehouseId)
      .eq('item_id', itemId)
      .is('location_id', null)
      .single();
    expect(Number(levelAfter.quantity_on_hand)).toBe(
      Number(levelBefore.quantity_on_hand),
    );
  }, 30_000);

  it('8. cancellation: shipment cancel releases reservation, records reason + history + exception, idempotent on repeat', async () => {
    const { shipmentId } = await createPickingShipment(5, 0);
    const { data: line } = await supabase
      .from('shipment_lines')
      .select('reservation_id')
      .eq('shipment_id', shipmentId)
      .single();

    const { data: cancelled, error } = await supabase.rpc(
      'fn_cancel_shipment',
      {
        p_shipment_id: shipmentId,
        p_tenant_id: TENANT,
        p_reason: 'customer changed their mind',
        p_actor_id: actorId,
      },
    );
    expect(error).toBeNull();
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.cancellation_reason).toBe('customer changed their mind');

    const { data: reservation } = await supabase
      .from('stock_reservations')
      .select('status')
      .eq('id', line.reservation_id)
      .single();
    expect(reservation.status).toBe('released');

    const { data: exceptions } = await supabase
      .from('warehouse_exceptions')
      .select('*')
      .eq('entity_type', 'shipment')
      .eq('entity_id', shipmentId)
      .eq('exception_type', 'cancelled');
    expect(exceptions).toHaveLength(1);

    const { data: history } = await supabase
      .from('warehouse_work_status_history')
      .select('*')
      .eq('entity_type', 'shipment')
      .eq('entity_id', shipmentId)
      .eq('new_status', 'cancelled');
    expect(history).toHaveLength(1);

    // Repeat cancellation is a no-op — idempotent, no duplicate reservation
    // release attempt (which would otherwise raise "not active"), no
    // duplicate exception/history row.
    const { data: repeat, error: repeatErr } = await supabase.rpc(
      'fn_cancel_shipment',
      {
        p_shipment_id: shipmentId,
        p_tenant_id: TENANT,
        p_reason: 'repeat attempt',
        p_actor_id: actorId,
      },
    );
    expect(repeatErr).toBeNull();
    expect(repeat.status).toBe('cancelled');

    const { count: exceptionCount } = await supabase
      .from('warehouse_exceptions')
      .select('*', { count: 'exact', head: true })
      .eq('entity_type', 'shipment')
      .eq('entity_id', shipmentId)
      .eq('exception_type', 'cancelled');
    expect(exceptionCount).toBe(1);
  }, 30_000);

  it('9. cancellation without reason is rejected', async () => {
    const { shipmentId } = await createPickingShipment(3, 0);
    const { error } = await supabase.rpc('fn_cancel_shipment', {
      p_shipment_id: shipmentId,
      p_tenant_id: TENANT,
      p_reason: '',
      p_actor_id: actorId,
    });
    expect(error).not.toBeNull();
  }, 30_000);

  it('10. cancellation of an already-shipped shipment is rejected', async () => {
    const { shipmentId, lineId } = await createPickingShipment(2, 0);
    const { data: pll } = await supabase
      .from('pick_list_lines')
      .select('id')
      .eq('pick_list_id', cleanupPickListIds[cleanupPickListIds.length - 1])
      .single();
    await supabase.rpc('fn_confirm_pick', {
      p_pick_list_line_id: pll.id,
      p_quantity: 2,
      p_actor_id: actorId,
    });
    const { data: line } = await supabase
      .from('shipment_lines')
      .select('*')
      .eq('id', lineId)
      .single();
    await supabase.rpc('fn_confirm_pack', {
      p_shipment_line_id: lineId,
      p_quantity: line.quantity_picked,
      p_actor_id: actorId,
    });
    await supabase.rpc('fn_ship_shipment', {
      p_shipment_id: shipmentId,
      p_actor_id: actorId,
      p_tracking_number: null,
    });

    const { error } = await supabase.rpc('fn_cancel_shipment', {
      p_shipment_id: shipmentId,
      p_tenant_id: TENANT,
      p_reason: 'too late',
      p_actor_id: actorId,
    });
    expect(error).not.toBeNull();
    expect(error.message).toContain('already shipped');
  }, 30_000);

  it('11. exception on a shipment not in picking state is rejected (e.g. already pending-only)', async () => {
    const { data: shipment } = await supabase
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
    cleanupShipmentIds.push(shipment.id);
    const { data: line } = await supabase
      .from('shipment_lines')
      .insert({
        tenant_id: TENANT,
        shipment_id: shipment.id,
        item_id: itemId,
        location_id: locationId,
        quantity_requested: 3,
      })
      .select()
      .single();

    const { error } = await supabase.rpc('fn_record_short_pick', {
      p_shipment_line_id: line.id,
      p_tenant_id: TENANT,
      p_reason: 'not picking yet',
      p_actor_id: actorId,
    });
    expect(error).not.toBeNull();
    expect(error.message).toContain('not in a pickable state');
  }, 30_000);

  it('12. shipment_line not found is rejected', async () => {
    const { error } = await supabase.rpc('fn_record_short_pick', {
      p_shipment_line_id: '00000000-0000-0000-0000-000000000000',
      p_tenant_id: TENANT,
      p_reason: 'x',
      p_actor_id: actorId,
    });
    expect(error).not.toBeNull();
    expect(error.message).toContain('not found');
  }, 30_000);

  it('13. multi-line shipment: one line short-picked, other line unaffected, pick list only completes once every line settles', async () => {
    const { data: shipment } = await supabase
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
    cleanupShipmentIds.push(shipment.id);

    const { data: item2 } = await supabase
      .from('items')
      .insert({
        tenant_id: TENANT,
        name: '7.7 Second Item',
        type: 'product',
        operation_type: 'sell',
        price: 3,
        is_active: true,
      })
      .select()
      .single();
    cleanupItemIds.push(item2.id);
    await supabase.rpc('fn_apply_stock_movement', {
      p_tenant_id: TENANT,
      p_warehouse_id: warehouseId,
      p_location_id: null,
      p_item_id: item2.id,
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

    await supabase.from('shipment_lines').insert([
      {
        tenant_id: TENANT,
        shipment_id: shipment.id,
        item_id: itemId,
        location_id: locationId,
        quantity_requested: 5,
      },
      {
        tenant_id: TENANT,
        shipment_id: shipment.id,
        item_id: item2.id,
        location_id: locationId,
        quantity_requested: 5,
      },
    ]);

    const { data: pickList } = await supabase.rpc('fn_create_pick_list', {
      p_tenant_id: TENANT,
      p_warehouse_id: warehouseId,
      p_shipment_ids: [shipment.id],
      p_strategy: 'single',
      p_zone_location_id: null,
      p_actor_id: actorId,
      p_priority: 'medium',
    });
    cleanupPickListIds.push(pickList.id);

    const { data: lines } = await supabase
      .from('shipment_lines')
      .select('*')
      .eq('shipment_id', shipment.id);
    const lineA = lines.find((l) => l.item_id === itemId);
    const lineB = lines.find((l) => l.item_id === item2.id);

    const { data: plls } = await supabase
      .from('pick_list_lines')
      .select('*')
      .eq('pick_list_id', pickList.id);
    const pllA = plls.find((p) => p.item_id === itemId);
    const pllB = plls.find((p) => p.item_id === item2.id);

    // Fully pick line B, partially pick line A (short by 2).
    await supabase.rpc('fn_confirm_pick', {
      p_pick_list_line_id: pllB.id,
      p_quantity: 5,
      p_actor_id: actorId,
    });
    await supabase.rpc('fn_confirm_pick', {
      p_pick_list_line_id: pllA.id,
      p_quantity: 3,
      p_actor_id: actorId,
    });

    const { data: plMid } = await supabase
      .from('pick_lists')
      .select('status')
      .eq('id', pickList.id)
      .single();
    expect(plMid.status).toBe('in_progress'); // line A still outstanding

    const { error } = await supabase.rpc('fn_record_short_pick', {
      p_shipment_line_id: lineA.id,
      p_tenant_id: TENANT,
      p_reason: 'shelf short',
      p_actor_id: actorId,
    });
    expect(error).toBeNull();

    const { data: lineBAfter } = await supabase
      .from('shipment_lines')
      .select('*')
      .eq('id', lineB.id)
      .single();
    expect(Number(lineBAfter.quantity_exception)).toBe(0);
    expect(Number(lineBAfter.quantity_picked)).toBe(5);

    const { data: plAfter } = await supabase
      .from('pick_lists')
      .select('status')
      .eq('id', pickList.id)
      .single();
    expect(plAfter.status).toBe('completed');

    const { data: shipmentAfter } = await supabase
      .from('shipments')
      .select('status')
      .eq('id', shipment.id)
      .single();
    expect(shipmentAfter.status).toBe('picked');
  }, 30_000);
});
