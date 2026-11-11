// Regression suite for Inventory #7 / F6 — Zone-Split Creation UI.
// Exercises the real WmsRepository.createZoneSplitPickLists ->
// fn_create_zone_pick_lists_for_shipments RPC (migration 229) directly
// against the real Supabase project, same pattern as the F2-F5 suites in
// this directory.
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { WmsRepository } from '../../../modules/inventory/repositories/wms.repository';

dotenv.config();

const TENANT = '9bcd3369-d664-47c8-b297-3bc9b429aacf'; // Sefay Demo

describe('Zone-Split Pick List Creation (Inventory #7 / F6)', () => {
  let supabase: SupabaseClient;
  let repo: WmsRepository;
  let warehouseId: string;
  let itemId: string;
  let actorId: string;

  let zoneA: string;
  let zoneB: string;
  let binA1: string;
  let binA2: string;
  let binB1: string;
  let noZoneBin: string; // a location with no zone ancestor at all

  const cleanupShipmentIds: string[] = [];
  const cleanupPickListIds: string[] = [];
  const cleanupLocationIds: string[] = [];

  const makeShipment = async (lines: { locationId: string | null; qty: number }[]) => {
    const { data: s } = await supabase
      .from('shipments')
      .insert({ tenant_id: TENANT, warehouse_id: warehouseId, reference_type: 'sale', reference_id: crypto.randomUUID(), status: 'pending' })
      .select().single();
    cleanupShipmentIds.push(s.id);
    for (const line of lines) {
      await supabase.from('shipment_lines').insert({
        tenant_id: TENANT, shipment_id: s.id, item_id: itemId, quantity_requested: line.qty, location_id: line.locationId,
      });
    }
    return s.id as string;
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
      .insert({ tenant_id: TENANT, name: 'F6 Zone Split Item', type: 'product', operation_type: 'sell', price: 5, is_active: true })
      .select().single();
    itemId = item.id;
    const { data: users } = await supabase.from('users').select('id').eq('tenant_id', TENANT).limit(1);
    actorId = users![0].id;

    // fn_create_reservation (called by the zone-split RPC per consolidated
    // line) requires real available stock — same established precedent as
    // every prior round's QA seeding (direct receipt insert, matching
    // fn_apply_stock_movement's real effect).
    const { data: movement } = await supabase.from('stock_movements').insert({
      tenant_id: TENANT, warehouse_id: warehouseId, item_id: itemId,
      movement_type: 'receipt', direction: 'in', quantity: 1000, unit_cost: 10, total_cost: 10000,
      reference_type: 'f6_regression_seed',
    }).select().single();
    await supabase.from('stock_levels').insert({ tenant_id: TENANT, warehouse_id: warehouseId, item_id: itemId, quantity_on_hand: 1000 });
    await supabase.from('cost_layers').insert({
      tenant_id: TENANT, warehouse_id: warehouseId, item_id: itemId, source_movement_id: movement.id,
      unit_cost: 10, quantity_received: 1000, quantity_remaining: 1000,
    });

    const mkLoc = async (name: string, type: string | null, parentId: string | null) => {
      const { data, error } = await supabase
        .from('warehouse_locations')
        .insert({ tenant_id: TENANT, warehouse_id: warehouseId, code: `F6-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name, location_type: type, parent_location_id: parentId })
        .select().single();
      if (error) throw new Error(`mkLoc(${name}) failed: ${JSON.stringify(error)}`);
      cleanupLocationIds.push(data.id);
      return data.id as string;
    };

    // Real hierarchy rule (fn INVALID_LOCATION_HIERARCHY): each level must
    // nest under exactly the next level up — zone -> aisle -> rack -> shelf
    // -> bin, no skipping. Two full chains under two zones, plus a second
    // bin under Zone A's aisle for the "multiple locations, same zone" case.
    zoneA = await mkLoc('Zone A', 'zone', null);
    zoneB = await mkLoc('Zone B', 'zone', null);
    const aisleA = await mkLoc('Aisle A', 'aisle', zoneA);
    const rackA = await mkLoc('Rack A', 'rack', aisleA);
    const shelfA = await mkLoc('Shelf A', 'shelf', rackA);
    const aisleB = await mkLoc('Aisle B', 'aisle', zoneB);
    const rackB = await mkLoc('Rack B', 'rack', aisleB);
    const shelfB = await mkLoc('Shelf B', 'shelf', rackB);
    binA1 = await mkLoc('Bin A1', 'bin', shelfA);
    binA2 = await mkLoc('Bin A2', 'bin', shelfA);
    binB1 = await mkLoc('Bin B1', 'bin', shelfB);
    // location_type=NULL is the real "untyped/legacy location" case (every
    // pre-migration-097 row) — fn_validate_location_hierarchy exempts it
    // entirely, and it correctly resolves to no zone in the recursive walk.
    noZoneBin = await mkLoc('Orphan Bin', null, null);
  }, 30000);

  afterAll(async () => {
    await supabase.from('warehouse_work_status_history').delete().in('entity_id', cleanupPickListIds);
    await supabase.from('stock_reservations').delete().eq('tenant_id', TENANT).eq('item_id', itemId);
    await supabase.from('pick_list_shipments').delete().in('pick_list_id', cleanupPickListIds);
    await supabase.from('pick_list_lines').delete().in('pick_list_id', cleanupPickListIds);
    await supabase.from('pick_lists').delete().in('id', cleanupPickListIds);
    await supabase.from('shipment_lines').delete().in('shipment_id', cleanupShipmentIds);
    await supabase.from('shipments').delete().in('id', cleanupShipmentIds);
    await supabase.from('warehouse_locations').delete().in('id', cleanupLocationIds);
    await supabase.from('cost_layers').delete().eq('tenant_id', TENANT).eq('item_id', itemId);
    await supabase.from('stock_levels').delete().eq('tenant_id', TENANT).eq('item_id', itemId);
    await supabase.from('items').delete().eq('id', itemId);
  }, 30000);

  it('1. single-zone shipment produces exactly one zone pick list', async () => {
    const shipmentId = await makeShipment([{ locationId: binA1, qty: 3 }]);
    const result = await repo.createZoneSplitPickLists(TENANT, warehouseId, [shipmentId], actorId) as any[];
    result.forEach((pl) => cleanupPickListIds.push(pl.id));

    expect(result).toHaveLength(1);
    expect(result[0].strategy).toBe('zone');
    expect(result[0].zone_location_id).toBe(zoneA);
    expect(result[0].status).toBe('in_progress');

    const { data: shipmentAfter } = await supabase.from('shipments').select('status').eq('id', shipmentId).single();
    expect(shipmentAfter.status).toBe('picking');
  }, 20000);

  it('2. two-zone shipment produces two pick lists, both linked to the same original shipment, with no quantity loss', async () => {
    const shipmentId = await makeShipment([{ locationId: binA1, qty: 4 }, { locationId: binB1, qty: 6 }]);
    const result = await repo.createZoneSplitPickLists(TENANT, warehouseId, [shipmentId], actorId) as any[];
    result.forEach((pl) => cleanupPickListIds.push(pl.id));

    expect(result).toHaveLength(2);
    const zones = result.map((pl) => pl.zone_location_id).sort();
    expect(zones).toEqual([zoneA, zoneB].sort());

    // Both pick lists must link back to the SAME original shipment.
    const { data: links } = await supabase.from('pick_list_shipments').select('pick_list_id, shipment_id').in('pick_list_id', result.map((pl) => pl.id));
    expect(links).toHaveLength(2);
    for (const link of links!) expect(link.shipment_id).toBe(shipmentId);

    // No quantity loss: sum of all created pick_list_lines == sum of shipment_lines.
    const { data: lines } = await supabase.from('pick_list_lines').select('quantity_to_pick').in('pick_list_id', result.map((pl) => pl.id));
    const totalCreated = lines!.reduce((s, l) => s + Number(l.quantity_to_pick), 0);
    expect(totalCreated).toBe(10); // 4 + 6
  }, 20000);

  it('3. same-zone consolidation: two shipments with lines only in the same zone produce ONE pick list, not two', async () => {
    const s1 = await makeShipment([{ locationId: binA1, qty: 2 }]);
    const s2 = await makeShipment([{ locationId: binA1, qty: 3 }]);
    const result = await repo.createZoneSplitPickLists(TENANT, warehouseId, [s1, s2], actorId) as any[];
    result.forEach((pl) => cleanupPickListIds.push(pl.id));

    expect(result).toHaveLength(1);
    expect(result[0].zone_location_id).toBe(zoneA);

    // Consolidated: same item+location across both shipments sums into one line.
    const { data: lines } = await supabase.from('pick_list_lines').select('quantity_to_pick, location_id').eq('pick_list_id', result[0].id);
    expect(lines).toHaveLength(1);
    expect(Number(lines![0].quantity_to_pick)).toBe(5); // 2 + 3

    // Both shipments must be linked to this one pick list.
    const { data: links } = await supabase.from('pick_list_shipments').select('shipment_id').eq('pick_list_id', result[0].id);
    expect(links!.map((l) => l.shipment_id).sort()).toEqual([s1, s2].sort());
  }, 20000);

  it('4. multiple locations in the same zone produce separate lines (not merged across locations), still one pick list', async () => {
    const shipmentId = await makeShipment([{ locationId: binA1, qty: 2 }, { locationId: binA2, qty: 5 }]);
    const result = await repo.createZoneSplitPickLists(TENANT, warehouseId, [shipmentId], actorId) as any[];
    result.forEach((pl) => cleanupPickListIds.push(pl.id));

    expect(result).toHaveLength(1); // one zone
    const { data: lines } = await supabase.from('pick_list_lines').select('quantity_to_pick, location_id').eq('pick_list_id', result[0].id);
    expect(lines).toHaveLength(2); // two distinct locations -> two lines, not consolidated together
    const total = lines!.reduce((s, l) => s + Number(l.quantity_to_pick), 0);
    expect(total).toBe(7);
  }, 20000);

  it('5. no resolvable zone: rejected atomically — shipment stays pending, nothing created', async () => {
    const shipmentId = await makeShipment([{ locationId: noZoneBin, qty: 1 }]);
    await expect(
      repo.createZoneSplitPickLists(TENANT, warehouseId, [shipmentId], actorId),
    ).rejects.toMatchObject({ message: expect.stringContaining('ZONE_SPLIT_NO_RESOLVABLE_ZONE') });

    const { data: shipmentAfter } = await supabase.from('shipments').select('status').eq('id', shipmentId).single();
    expect(shipmentAfter.status).toBe('pending'); // never claimed
    const { count } = await supabase.from('pick_lists').select('*', { count: 'exact', head: true }).eq('warehouse_id', warehouseId).is('deleted_at', null);
    // (not asserting an exact count against shared demo data — just that this
    // shipment produced none, verified via pick_list_shipments below)
    const { data: links } = await supabase.from('pick_list_shipments').select('id').eq('shipment_id', shipmentId);
    expect(links).toHaveLength(0);
    void count;
  }, 20000);

  it('6. shipment already processed: a second zone-split attempt on the same shipment is rejected, not silently re-applied', async () => {
    const shipmentId = await makeShipment([{ locationId: binA1, qty: 1 }]);
    const first = await repo.createZoneSplitPickLists(TENANT, warehouseId, [shipmentId], actorId) as any[];
    first.forEach((pl) => cleanupPickListIds.push(pl.id));

    await expect(
      repo.createZoneSplitPickLists(TENANT, warehouseId, [shipmentId], actorId),
    ).rejects.toMatchObject({ message: expect.stringContaining('is not pending') });
  }, 20000);

  it('7. tenant isolation: zone-split under the wrong tenant is rejected as not-found', async () => {
    const shipmentId = await makeShipment([{ locationId: binA1, qty: 1 }]);
    const { data: otherTenant } = await supabase.from('tenants').select('id').neq('id', TENANT).limit(1);
    if (!otherTenant?.[0]) return;
    await expect(
      repo.createZoneSplitPickLists(otherTenant[0].id, warehouseId, [shipmentId], actorId),
    ).rejects.toMatchObject({ message: expect.stringContaining('not found') });
  }, 20000);

  it('8. warehouse isolation: a shipment from a different warehouse is rejected', async () => {
    const { data: otherWh } = await supabase
      .from('warehouses')
      .insert({ tenant_id: TENANT, branch_id: (await supabase.from('warehouses').select('branch_id').eq('id', warehouseId).single()).data!.branch_id, name: 'F6 Other WH', code: `F6OW-${Date.now()}` })
      .select().single();
    const shipmentId = await makeShipment([{ locationId: binA1, qty: 1 }]);
    await expect(
      repo.createZoneSplitPickLists(TENANT, otherWh.id, [shipmentId], actorId),
    ).rejects.toMatchObject({ message: expect.stringContaining('not found') });
    await supabase.from('warehouses').delete().eq('id', otherWh.id);
  }, 20000);

  it('9. reservation correctness: a real stock_reservation is created per consolidated line and linked back to the shipment_lines', async () => {
    const shipmentId = await makeShipment([{ locationId: binA1, qty: 4 }]);
    const result = await repo.createZoneSplitPickLists(TENANT, warehouseId, [shipmentId], actorId) as any[];
    result.forEach((pl) => cleanupPickListIds.push(pl.id));

    const { data: pll } = await supabase.from('pick_list_lines').select('id').eq('pick_list_id', result[0].id).single();
    const { data: reservation } = await supabase.from('stock_reservations').select('quantity, status, reference_type, reference_id').eq('reference_type', 'pick_list_line').eq('reference_id', pll!.id).single();
    expect(Number(reservation.quantity)).toBe(4);
    expect(reservation.status).toBe('active');

    const { data: shipLine } = await supabase.from('shipment_lines').select('reservation_id').eq('shipment_id', shipmentId).single();
    expect(shipLine.reservation_id).not.toBeNull();
  }, 20000);

  it('10. concurrency: two real parallel zone-split requests on the same shipment — exactly one succeeds, no duplicate pick lists', async () => {
    const shipmentId = await makeShipment([{ locationId: binA1, qty: 2 }]);
    const results = await Promise.allSettled([
      repo.createZoneSplitPickLists(TENANT, warehouseId, [shipmentId], actorId),
      repo.createZoneSplitPickLists(TENANT, warehouseId, [shipmentId], actorId),
    ]);
    const succeeded = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<any[]>[];
    const failed = results.filter((r) => r.status === 'rejected');
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    succeeded[0].value.forEach((pl: any) => cleanupPickListIds.push(pl.id));

    const { data: links } = await supabase.from('pick_list_shipments').select('id').eq('shipment_id', shipmentId);
    expect(links).toHaveLength(1); // only the winning request's pick list linked
  }, 20000);

  it('11. empty shipment selection is rejected', async () => {
    await expect(
      repo.createZoneSplitPickLists(TENANT, warehouseId, [], actorId),
    ).rejects.toMatchObject({ message: expect.stringContaining('at least one shipment is required') });
  });
});
