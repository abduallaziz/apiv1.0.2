// Regression suite for Inventory #7 / F5 — Pick List Cancel.
// Exercises the real WmsRepository.cancelPickList -> fn_cancel_pick_list
// RPC directly against the real Supabase project (same pattern as the
// F2/F3/F4 suites in this directory).
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { WmsRepository } from '../../../modules/inventory/repositories/wms.repository';

dotenv.config();

const TENANT = '9bcd3369-d664-47c8-b297-3bc9b429aacf'; // Sefay Demo

describe('Pick List Cancel (Inventory #7 / F5)', () => {
  let supabase: SupabaseClient;
  let repo: WmsRepository;
  let warehouseId: string;
  let itemId: string;
  let actorId: string;

  const cleanupPickListIds: string[] = [];
  const cleanupShipmentIds: string[] = [];
  const cleanupReservationIds: string[] = [];

  const makePickList = async (status = 'open') => {
    const { data: pl } = await supabase
      .from('pick_lists')
      .insert({ tenant_id: TENANT, warehouse_id: warehouseId, strategy: 'single', status, priority: 'medium' })
      .select().single();
    cleanupPickListIds.push(pl.id);
    return pl.id as string;
  };

  // Builds a pick list wired to a real shipment (status='picking') with a
  // real active reservation on its line, so the cancel RPC's reservation-
  // release and shipment-revert side effects can be verified against DB
  // truth, not just the pick_lists row itself.
  const makePickListWithReservationAndShipment = async () => {
    // fn_release_reservation decrements stock_levels.quantity_reserved for
    // this (tenant, warehouse, item) point — a reservation with nothing
    // backing it there makes the release compute a negative reserved
    // quantity and fail stock_levels' own CHECK constraint. Real prior
    // state always has a stock_levels row before a reservation exists.
    // itemId is freshly created per suite run, so there is never a prior
    // stock_levels row to conflict with — a plain upsert-by-select avoids
    // relying on the exact composite unique index shape.
    const { data: existingLevel } = await supabase
      .from('stock_levels')
      .select('id, quantity_reserved')
      .eq('tenant_id', TENANT).eq('warehouse_id', warehouseId).eq('item_id', itemId)
      .is('location_id', null).is('variant_id', null).is('batch_id', null)
      .maybeSingle();
    if (existingLevel) {
      await supabase.from('stock_levels').update({ quantity_reserved: existingLevel.quantity_reserved + 2, quantity_on_hand: 10 }).eq('id', existingLevel.id);
    } else {
      await supabase.from('stock_levels').insert({ tenant_id: TENANT, warehouse_id: warehouseId, item_id: itemId, quantity_on_hand: 10, quantity_reserved: 2 });
    }

    const { data: reservation } = await supabase
      .from('stock_reservations')
      .insert({ tenant_id: TENANT, warehouse_id: warehouseId, item_id: itemId, quantity: 2, status: 'active', reference_type: 'shipment', reference_id: crypto.randomUUID() })
      .select().single();
    cleanupReservationIds.push(reservation.id);

    const { data: shipment } = await supabase
      .from('shipments')
      .insert({ tenant_id: TENANT, warehouse_id: warehouseId, reference_type: 'sale', reference_id: crypto.randomUUID(), status: 'picking' })
      .select().single();
    cleanupShipmentIds.push(shipment.id);

    await supabase
      .from('shipment_lines')
      .insert({ tenant_id: TENANT, shipment_id: shipment.id, item_id: itemId, quantity_requested: 2, reservation_id: reservation.id });

    const id = await makePickList('in_progress');
    await supabase.from('pick_list_shipments').insert({ tenant_id: TENANT, pick_list_id: id, shipment_id: shipment.id });

    return { pickListId: id, shipmentId: shipment.id as string, reservationId: reservation.id as string };
  };

  beforeAll(async () => {
    supabase = createClient(
      process.env.SUPABASE_URL as string,
      process.env.SUPABASE_SERVICE_ROLE_KEY as string,
    );
    repo = new WmsRepository(supabase);

    const { data: wh } = await supabase.from('warehouses').select('id').eq('tenant_id', TENANT).limit(1);
    warehouseId = wh![0].id;
    const { data: item } = await supabase
      .from('items')
      .insert({ tenant_id: TENANT, name: 'F5 Cancel Item', type: 'product', operation_type: 'sell', price: 5, is_active: true })
      .select().single();
    itemId = item.id;
    const { data: users } = await supabase.from('users').select('id').eq('tenant_id', TENANT).limit(1);
    actorId = users![0].id;
  }, 30000);

  afterAll(async () => {
    await supabase.from('warehouse_work_status_history').delete().in('entity_id', cleanupPickListIds);
    await supabase.from('pick_list_shipments').delete().in('pick_list_id', cleanupPickListIds);
    await supabase.from('pick_lists').delete().in('id', cleanupPickListIds);
    await supabase.from('shipment_lines').delete().in('shipment_id', cleanupShipmentIds);
    await supabase.from('shipments').delete().in('id', cleanupShipmentIds);
    await supabase.from('stock_reservations').delete().in('id', cleanupReservationIds);
    await supabase.from('stock_levels').delete().eq('tenant_id', TENANT).eq('item_id', itemId);
    await supabase.from('items').delete().eq('id', itemId);
  }, 30000);

  it('1. successful cancellation: status becomes cancelled, reason persists, history records the transition with a real actor', async () => {
    const id = await makePickList('open');
    const result = await repo.cancelPickList(id, TENANT, 'F5 regression reason', actorId) as any;
    expect(result.status).toBe('cancelled');
    expect(result.cancellation_reason).toBe('F5 regression reason');

    const after = await repo.findPickListById(id, TENANT) as any;
    expect(after.status).toBe('cancelled');
    expect(after.cancellation_reason).toBe('F5 regression reason');

    const history = await repo.findPickListHistory(id, TENANT) as any[];
    const entry = history.find((h) => h.new_status === 'cancelled');
    expect(entry).toBeDefined();
    expect(entry.old_status).toBe('open');
    expect(entry.actor_id).toBe(actorId);
    expect(entry.notes).toBe('F5 regression reason'); // real backend behavior: notes = the reason verbatim
  });

  it('2. required reason: empty string is rejected server-side, not silently accepted', async () => {
    const id = await makePickList('open');
    await expect(repo.cancelPickList(id, TENANT, '', actorId)).rejects.toMatchObject({
      message: expect.stringContaining('reason is required'),
    });
    const after = await repo.findPickListById(id, TENANT) as any;
    expect(after.status).toBe('open'); // unaffected
  });

  it('3. required reason: whitespace-only is rejected (server trims via btrim)', async () => {
    const id = await makePickList('open');
    await expect(repo.cancelPickList(id, TENANT, '   ', actorId)).rejects.toMatchObject({
      message: expect.stringContaining('reason is required'),
    });
  });

  it('4. reason is sent verbatim — no truncation, no enum mapping', async () => {
    const id = await makePickList('open');
    const longReason = 'Customer requested cancellation due to address change and delayed availability of item stock at this specific warehouse location.';
    const result = await repo.cancelPickList(id, TENANT, longReason, actorId) as any;
    expect(result.cancellation_reason).toBe(longReason);
  });

  it('5. status gating: a completed pick list rejects cancellation', async () => {
    const id = await makePickList('completed');
    await expect(repo.cancelPickList(id, TENANT, 'reason', actorId)).rejects.toMatchObject({
      message: expect.stringContaining('cannot be cancelled'),
    });
  });

  it('6. status gating: an already-cancelled pick list rejects a second cancellation (idempotency boundary, not silently re-applied)', async () => {
    const id = await makePickList('open');
    await repo.cancelPickList(id, TENANT, 'first cancel', actorId);
    await expect(repo.cancelPickList(id, TENANT, 'second cancel', actorId)).rejects.toMatchObject({
      message: expect.stringContaining('cannot be cancelled'),
    });
    const after = await repo.findPickListById(id, TENANT) as any;
    expect(after.cancellation_reason).toBe('first cancel'); // second attempt never applied
  });

  it('7. not found: cancelling a nonexistent pick list is rejected, not fabricated as success', async () => {
    await expect(
      repo.cancelPickList('00000000-0000-0000-0000-000000000000', TENANT, 'reason', actorId),
    ).rejects.toMatchObject({ message: expect.stringContaining('not found') });
  });

  it('8. tenant isolation: cancelling under the wrong tenant id is rejected as not-found, not applied cross-tenant', async () => {
    const id = await makePickList('open');
    const { data: otherTenant } = await supabase.from('tenants').select('id').neq('id', TENANT).limit(1);
    if (!otherTenant?.[0]) return;
    await expect(repo.cancelPickList(id, otherTenant[0].id, 'reason', actorId)).rejects.toMatchObject({
      message: expect.stringContaining('not found'),
    });
    const after = await repo.findPickListById(id, TENANT) as any;
    expect(after.status).toBe('open');
  });

  it('9. reservation and shipment effects: cancellation releases the linked active reservation and reverts the picking shipment to pending', async () => {
    const { pickListId, shipmentId, reservationId } = await makePickListWithReservationAndShipment();

    const { data: reservationBefore } = await supabase.from('stock_reservations').select('status').eq('id', reservationId).single();
    expect(reservationBefore.status).toBe('active');
    const { data: shipmentBefore } = await supabase.from('shipments').select('status').eq('id', shipmentId).single();
    expect(shipmentBefore.status).toBe('picking');

    await repo.cancelPickList(pickListId, TENANT, 'release check', actorId);

    const { data: reservationAfter } = await supabase.from('stock_reservations').select('status, released_at').eq('id', reservationId).single();
    expect(reservationAfter.status).toBe('released');
    expect(reservationAfter.released_at).not.toBeNull();

    const { data: shipmentAfter } = await supabase.from('shipments').select('status').eq('id', shipmentId).single();
    expect(shipmentAfter.status).toBe('pending');
  }, 20000); // makePickListWithReservationAndShipment issues several sequential real DB round-trips — exceeds the 5000ms default under full-suite load.

  it('10. concurrency: two real parallel cancel requests on the same pick list — exactly one business effect, no duplicate reservation release', async () => {
    const { pickListId, reservationId } = await makePickListWithReservationAndShipment();

    const results = await Promise.allSettled([
      repo.cancelPickList(pickListId, TENANT, 'race A', actorId),
      repo.cancelPickList(pickListId, TENANT, 'race B', actorId),
    ]);
    // fn_cancel_pick_list row-locks the pick list (FOR UPDATE): exactly one
    // of the two racing requests should succeed, the other should see the
    // now-'cancelled' status and be rejected by the status guard.
    const succeeded = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);

    const after = await repo.findPickListById(pickListId, TENANT) as any;
    expect(after.status).toBe('cancelled');
    expect(['race A', 'race B']).toContain(after.cancellation_reason);

    // The reservation must be released exactly once (idempotent business
    // effect), never double-processed by the losing racer.
    const { data: reservationAfter } = await supabase.from('stock_reservations').select('status').eq('id', reservationId).single();
    expect(reservationAfter.status).toBe('released');

    const history = await repo.findPickListHistory(pickListId, TENANT) as any[];
    const cancelEntries = history.filter((h) => h.new_status === 'cancelled');
    expect(cancelEntries).toHaveLength(1); // only the winning request wrote history
  }, 20000);
});
