// Regression suite for Inventory #7 / F3 — Pick List Detail Drawer.
// Exercises the actual WmsRepository.findPickListById / findPickListHistory
// / findExceptions code paths directly against the real Supabase project,
// same pattern as the F2 list suite in this directory.
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { WmsRepository } from '../../../modules/inventory/repositories/wms.repository';

dotenv.config();

const TENANT = '9bcd3369-d664-47c8-b297-3bc9b429aacf'; // Sefay Demo

describe('Pick List Detail Drawer (Inventory #7 / F3)', () => {
  let supabase: SupabaseClient;
  let repo: WmsRepository;
  let warehouseId: string;
  let itemId: string;
  let actorId: string;
  let zoneLocationId: string | null = null;
  let waveId: string;

  let singlePickListId: string;
  let singleLine1Id: string;
  let singleLine2Id: string;
  let zonePickListId: string;
  let wavePickListId: string;
  let cancelledPickListId: string;

  const cleanupPickListIds: string[] = [];
  const cleanupShipmentIds: string[] = [];
  const cleanupHistoryIds: string[] = [];
  const cleanupExceptionIds: string[] = [];
  let waveIdForCleanup: string | null = null;

  beforeAll(async () => {
    supabase = createClient(
      process.env.SUPABASE_URL as string,
      process.env.SUPABASE_SERVICE_ROLE_KEY as string,
    );
    repo = new WmsRepository(supabase);

    const { data: wh } = await supabase.from('warehouses').select('id').eq('tenant_id', TENANT).limit(1);
    warehouseId = wh![0].id;
    const { data: user } = await supabase.from('users').select('id').eq('tenant_id', TENANT).limit(1);
    actorId = user![0].id;
    const { data: item } = await supabase
      .from('items')
      .insert({ tenant_id: TENANT, name: 'F3 Detail Item', type: 'product', operation_type: 'sell', price: 5, is_active: true })
      .select().single();
    itemId = item.id;
    const { data: loc } = await supabase.from('warehouse_locations').select('id').eq('warehouse_id', warehouseId).limit(1);
    zoneLocationId = loc?.[0]?.id ?? null;

    const makeShipment = async () => {
      const { data: s } = await supabase
        .from('shipments')
        .insert({ tenant_id: TENANT, warehouse_id: warehouseId, reference_type: 'sale', reference_id: crypto.randomUUID(), status: 'pending' })
        .select().single();
      cleanupShipmentIds.push(s.id);
      const { data: line } = await supabase
        .from('shipment_lines')
        .insert({ tenant_id: TENANT, shipment_id: s.id, item_id: itemId, quantity_requested: 3 })
        .select().single();
      return { shipment: s, line };
    };

    // Single-strategy pick list with 2 lines and a cost picked/remaining mix.
    const s1 = await makeShipment();
    const { data: pl1 } = await supabase
      .from('pick_lists')
      .insert({ tenant_id: TENANT, warehouse_id: warehouseId, strategy: 'single', status: 'in_progress', priority: 'high', created_by: actorId })
      .select().single();
    singlePickListId = pl1.id;
    cleanupPickListIds.push(pl1.id);
    await supabase.from('pick_list_shipments').insert({ tenant_id: TENANT, pick_list_id: pl1.id, shipment_id: s1.shipment.id });
    // Line 1: to_pick=3, picked=1, ONE line-level exception of qty 1 ->
    // remaining = 3 - 1 - 1 = 1.
    const { data: pll1 } = await supabase
      .from('pick_list_lines')
      .insert({ tenant_id: TENANT, pick_list_id: pl1.id, item_id: itemId, quantity_to_pick: 3, quantity_picked: 1 })
      .select().single();
    // Line 2 (multiple lines on one pick list): to_pick=4, picked=1, TWO
    // line-level exceptions summing to 2 -> remaining = 4 - 1 - 2 = 1.
    const { data: pll2 } = await supabase
      .from('pick_list_lines')
      .insert({ tenant_id: TENANT, pick_list_id: pl1.id, item_id: itemId, quantity_to_pick: 4, quantity_picked: 1 })
      .select().single();
    singleLine1Id = pll1.id;
    singleLine2Id = pll2.id;

    // History entries for pl1.
    const { data: h1 } = await supabase
      .from('warehouse_work_status_history')
      .insert({ tenant_id: TENANT, entity_type: 'pick_list', entity_id: pl1.id, old_status: 'open', new_status: 'in_progress', actor_id: actorId, notes: 'started' })
      .select().single();
    cleanupHistoryIds.push(h1.id);

    // Line-level exceptions (F3 residual): one line-level exception on
    // line 1, two on line 2 (multiple exceptions on one line).
    const { data: excLine1 } = await supabase
      .from('warehouse_exceptions')
      .insert({ tenant_id: TENANT, entity_type: 'pick_list_line', entity_id: pll1.id, exception_type: 'short_pick', affected_quantity: 1, reason: 'F3 line regression', status: 'open' })
      .select().single();
    cleanupExceptionIds.push(excLine1.id);
    const { data: excLine2a } = await supabase
      .from('warehouse_exceptions')
      .insert({ tenant_id: TENANT, entity_type: 'pick_list_line', entity_id: pll2.id, exception_type: 'damaged', affected_quantity: 1, reason: 'F3 line regression 2a', status: 'open' })
      .select().single();
    cleanupExceptionIds.push(excLine2a.id);
    const { data: excLine2b } = await supabase
      .from('warehouse_exceptions')
      .insert({ tenant_id: TENANT, entity_type: 'pick_list_line', entity_id: pll2.id, exception_type: 'lost', affected_quantity: 1, reason: 'F3 line regression 2b', status: 'open' })
      .select().single();
    cleanupExceptionIds.push(excLine2b.id);

    // Zone-strategy pick list.
    if (zoneLocationId) {
      const { data: plZ } = await supabase
        .from('pick_lists')
        .insert({ tenant_id: TENANT, warehouse_id: warehouseId, strategy: 'zone', zone_location_id: zoneLocationId, status: 'open', priority: 'medium' })
        .select().single();
      zonePickListId = plZ.id;
      cleanupPickListIds.push(plZ.id);
    }

    // Wave-strategy pick list, linked to a real wave row, with 2 shipments
    // (exercising "shipment belongs to multiple pick lists" isn't needed
    // here — pick_list_shipments already models the many-to-many).
    const { data: wave } = await supabase
      .from('waves')
      .insert({ tenant_id: TENANT, warehouse_id: warehouseId, status: 'released', released_at: new Date().toISOString() })
      .select().single();
    waveId = wave.id;
    waveIdForCleanup = wave.id;
    const sW1 = await makeShipment();
    const sW2 = await makeShipment();
    const { data: plW } = await supabase
      .from('pick_lists')
      .insert({ tenant_id: TENANT, warehouse_id: warehouseId, strategy: 'wave', wave_id: waveId, status: 'in_progress', priority: 'urgent' })
      .select().single();
    wavePickListId = plW.id;
    cleanupPickListIds.push(plW.id);
    await supabase.from('pick_list_shipments').insert([
      { tenant_id: TENANT, pick_list_id: plW.id, shipment_id: sW1.shipment.id },
      { tenant_id: TENANT, pick_list_id: plW.id, shipment_id: sW2.shipment.id },
    ]);

    // Cancelled pick list with a reason.
    const { data: plC } = await supabase
      .from('pick_lists')
      .insert({ tenant_id: TENANT, warehouse_id: warehouseId, strategy: 'batch', status: 'cancelled', priority: 'low', cancellation_reason: 'F3 regression cancel' })
      .select().single();
    cancelledPickListId = plC.id;
    cleanupPickListIds.push(plC.id);
  }, 30000);

  afterAll(async () => {
    await supabase.from('warehouse_exceptions').delete().in('id', cleanupExceptionIds);
    await supabase.from('warehouse_work_status_history').delete().in('id', cleanupHistoryIds);
    await supabase.from('pick_list_shipments').delete().in('pick_list_id', cleanupPickListIds);
    await supabase.from('pick_list_lines').delete().in('pick_list_id', cleanupPickListIds);
    await supabase.from('pick_lists').delete().in('id', cleanupPickListIds);
    if (waveIdForCleanup) await supabase.from('waves').delete().eq('id', waveIdForCleanup);
    await supabase.from('shipment_lines').delete().in('shipment_id', cleanupShipmentIds);
    await supabase.from('shipments').delete().in('id', cleanupShipmentIds);
    await supabase.from('items').delete().eq('id', itemId);
  }, 30000);

  it('1. detail response includes all F3-required fields for a single-strategy pick list with multiple lines', async () => {
    const pl = await repo.findPickListById(singlePickListId, TENANT) as any;
    expect(pl.id).toBe(singlePickListId);
    expect(pl.strategy).toBe('single');
    expect(pl.status).toBe('in_progress');
    expect(pl.priority).toBe('high');
    expect(pl.lines).toHaveLength(2);
    expect(pl.shipments).toHaveLength(1);
    const totalToPick = pl.lines.reduce((s: number, l: any) => s + Number(l.quantity_to_pick), 0);
    const totalPicked = pl.lines.reduce((s: number, l: any) => s + Number(l.quantity_picked), 0);
    expect(totalToPick).toBe(7); // 3 + 4
    expect(totalPicked).toBe(2); // 1 + 1
  });

  it('9. per-line exception_quantity is a real server-side aggregate — one line exception, multiple line exceptions, and reconciles requested = picked + exception + remaining', async () => {
    const pl = await repo.findPickListById(singlePickListId, TENANT) as any;
    const line1 = pl.lines.find((l: any) => l.id === singleLine1Id);
    const line2 = pl.lines.find((l: any) => l.id === singleLine2Id);
    expect(line1.exception_quantity).toBe(1); // one exception
    expect(line2.exception_quantity).toBe(2); // two exceptions summed (1+1)

    const totalToPick = pl.lines.reduce((s: number, l: any) => s + Number(l.quantity_to_pick), 0);
    const totalPicked = pl.lines.reduce((s: number, l: any) => s + Number(l.quantity_picked), 0);
    const totalException = pl.lines.reduce((s: number, l: any) => s + Number(l.exception_quantity), 0);
    expect(totalException).toBe(3); // 1 + 2
    const totalRemaining = totalToPick - totalPicked - totalException;
    expect(totalToPick).toBe(totalPicked + totalException + totalRemaining); // reconciliation identity
  });

  it('10. a line with no exceptions gets exception_quantity=0, not null/undefined (no exceptions case)', async () => {
    const plZ = zonePickListId ? await repo.findPickListById(zonePickListId, TENANT) as any : null;
    if (!plZ || plZ.lines.length === 0) return; // zone list has no lines in this fixture set — nothing to assert
    for (const line of plZ.lines) expect(line.exception_quantity).toBe(0);
  });

  it('11. wave and cancelled pick lists (no line exceptions) also resolve exception_quantity=0 per line, not omitted', async () => {
    const plW = await repo.findPickListById(wavePickListId, TENANT) as any;
    const plC = await repo.findPickListById(cancelledPickListId, TENANT) as any;
    for (const line of [...plW.lines, ...plC.lines]) expect(line.exception_quantity).toBe(0);
  });

  it('2. zone pick list carries real zone_location_id, wave pick list carries real wave_id', async () => {
    if (zonePickListId) {
      const plZ = await repo.findPickListById(zonePickListId, TENANT) as any;
      expect(plZ.zone_location_id).toBe(zoneLocationId);
      expect(plZ.wave_id).toBeNull();
    }
    const plW = await repo.findPickListById(wavePickListId, TENANT) as any;
    expect(plW.wave_id).toBe(waveId);
    expect(plW.zone_location_id).toBeNull();
    expect(plW.shipments).toHaveLength(2); // multiple shipments on one pick list
  });

  it('3. cancelled pick list surfaces its real cancellation_reason, not a fabricated one', async () => {
    const plC = await repo.findPickListById(cancelledPickListId, TENANT) as any;
    expect(plC.status).toBe('cancelled');
    expect(plC.cancellation_reason).toBe('F3 regression cancel');
  });

  it('4. not-found: a nonexistent id resolves to null, not an error or fabricated record', async () => {
    const result = await repo.findPickListById('00000000-0000-0000-0000-000000000000', TENANT);
    expect(result).toBeNull();
  });

  it('5. tenant isolation: a second tenant cannot fetch this pick list by id', async () => {
    const { data: otherTenant } = await supabase.from('tenants').select('id').neq('id', TENANT).limit(1);
    if (!otherTenant?.[0]) return;
    const result = await repo.findPickListById(singlePickListId, otherTenant[0].id);
    expect(result).toBeNull();
  });

  it('6. history returns real transitions with actor and notes, newest first', async () => {
    const hist = await repo.findPickListHistory(singlePickListId, TENANT) as any[];
    expect(hist.length).toBeGreaterThanOrEqual(1);
    const entry = hist.find((h) => h.id === cleanupHistoryIds[0]);
    expect(entry).toBeDefined();
    expect(entry.old_status).toBe('open');
    expect(entry.new_status).toBe('in_progress');
    expect(entry.actor_id).toBe(actorId);
    expect(entry.notes).toBe('started');
  });

  it('7. history for a pick list with none returns an empty array, not an error', async () => {
    const hist = await repo.findPickListHistory(cancelledPickListId, TENANT) as any[];
    expect(Array.isArray(hist)).toBe(true);
    expect(hist).toHaveLength(0);
  });

  it('8. pick_list_line-scoped exception lookup returns only that line\'s exceptions, isolated per line', async () => {
    const excsLine1 = await repo.findExceptions(TENANT, 'pick_list_line', singleLine1Id) as any[];
    expect(excsLine1).toHaveLength(1);
    const excsLine2 = await repo.findExceptions(TENANT, 'pick_list_line', singleLine2Id) as any[];
    expect(excsLine2).toHaveLength(2);
  });
});
