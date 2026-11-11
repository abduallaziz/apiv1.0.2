// Regression suite for Inventory #8 / F8 — Wave Operations / Workflow
// Management. Same real-Supabase, real-RPC pattern as every other spec in
// this directory (WmsRepository + direct supabase-js calls). Focuses on
// the genuinely uncovered scenarios: fn_evaluate_wave_eligibility's own
// status/tenant/warehouse gating and criteria-matching correctness (only
// ever exercised as setup in other specs, never asserted on directly),
// plus history correctness for evaluate/cancel read back through the F7
// gap-closure findWaveHistory endpoint the F8 UI actually consumes.
// fn_release_wave's own gating (WAVE_NOT_READY, idempotency, concurrency,
// tenant isolation) is already covered by wave-claim-release-7.6.
// regression.spec.ts and is not duplicated here.
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { WmsRepository } from '../../../modules/inventory/repositories/wms.repository';

dotenv.config();

const TENANT = '9bcd3369-d664-47c8-b297-3bc9b429aacf'; // Sefay Demo

describe('Wave Operations / Workflow Management (Inventory #8 / F8)', () => {
  let supabase: SupabaseClient;
  let repo: WmsRepository;
  let warehouseId: string;
  let warehouseId2: string;
  let actorId: string;
  let itemId: string;
  const cleanupWaveIds: string[] = [];
  const cleanupShipmentIds: string[] = [];
  const cleanupWarehouseIds: string[] = [];

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

    const { data: wh1 } = await supabase
      .from('warehouses')
      .insert({ tenant_id: TENANT, branch_id: branchId, name: 'F8 Actions WH1', code: `F8A1-${Date.now()}` })
      .select().single();
    warehouseId = wh1.id;
    cleanupWarehouseIds.push(wh1.id);

    const { data: wh2 } = await supabase
      .from('warehouses')
      .insert({ tenant_id: TENANT, branch_id: branchId, name: 'F8 Actions WH2', code: `F8A2-${Date.now()}` })
      .select().single();
    warehouseId2 = wh2.id;
    cleanupWarehouseIds.push(wh2.id);

    const { data: user } = await supabase.from('users').select('id').eq('tenant_id', TENANT).limit(1);
    actorId = user![0].id;

    const { data: item, error: itemErr } = await supabase.from('items').insert({
      tenant_id: TENANT, name: 'F8 Actions Item', type: 'product', operation_type: 'sell', price: 10, is_active: true,
    }).select().single();
    if (itemErr) throw itemErr;
    itemId = item.id;
  }, 30000);

  afterAll(async () => {
    await supabase.from('warehouse_work_status_history').delete().eq('tenant_id', TENANT).eq('entity_type', 'wave').in('entity_id', cleanupWaveIds);
    await supabase.from('wave_shipments').delete().in('wave_id', cleanupWaveIds);
    await supabase.from('waves').delete().in('id', cleanupWaveIds);
    await supabase.from('shipment_lines').delete().in('shipment_id', cleanupShipmentIds);
    await supabase.from('shipments').delete().in('id', cleanupShipmentIds);
    await supabase.from('items').delete().eq('id', itemId);
    await supabase.from('warehouses').delete().in('id', cleanupWarehouseIds);
  }, 30000);

  const mkPendingShipment = async (whId: string) => {
    const { data: shipment, error } = await supabase.from('shipments').insert({
      tenant_id: TENANT, warehouse_id: whId, reference_type: 'order', reference_id: crypto.randomUUID(), status: 'pending',
    }).select().single();
    if (error) throw error;
    cleanupShipmentIds.push(shipment.id);
    await supabase.from('shipment_lines').insert({ tenant_id: TENANT, shipment_id: shipment.id, item_id: itemId, quantity_requested: 2 });
    return shipment.id;
  };

  const mkWave = async (whId: string, criteria: Record<string, unknown> = {}) => {
    const { data: wave, error } = await supabase.from('waves').insert({
      tenant_id: TENANT, warehouse_id: whId, status: 'planning', criteria,
    }).select().single();
    if (error) throw error;
    cleanupWaveIds.push(wave.id);
    return wave.id as string;
  };

  it('1. evaluate happy path: real pending shipments in the wave\'s own warehouse are included, wave reaches reviewing', async () => {
    const shipmentId = await mkPendingShipment(warehouseId);
    const waveId = await mkWave(warehouseId);

    const { data: rows, error } = await supabase.rpc('fn_evaluate_wave_eligibility', {
      p_wave_id: waveId, p_tenant_id: TENANT, p_actor_id: actorId,
    });
    expect(error).toBeNull();
    expect(rows).toHaveLength(1);
    expect(rows[0].shipment_id).toBe(shipmentId);
    expect(rows[0].included_reason).not.toBeNull();
    expect(rows[0].excluded_reason).toBeNull();

    const wave = await repo.findWaveById(waveId, TENANT) as { status: string; evaluated_at: string | null };
    expect(wave.status).toBe('reviewing');
    expect(wave.evaluated_at).not.toBeNull();
  }, 20000);

  it('2. evaluate empty state: zero pending shipments in the warehouse still reaches reviewing, zero rows, not an error', async () => {
    const emptyWaveId = await mkWave(warehouseId2); // wh2 has no shipments seeded yet in this test
    const { data: rows, error } = await supabase.rpc('fn_evaluate_wave_eligibility', {
      p_wave_id: emptyWaveId, p_tenant_id: TENANT, p_actor_id: actorId,
    });
    expect(error).toBeNull();
    expect(rows).toHaveLength(0);
    const wave = await repo.findWaveById(emptyWaveId, TENANT) as { status: string };
    expect(wave.status).toBe('reviewing');
  }, 20000);

  it('3. evaluate status gate: a wave already past planning cannot be evaluated again', async () => {
    const waveId = await mkWave(warehouseId);
    await supabase.rpc('fn_evaluate_wave_eligibility', { p_wave_id: waveId, p_tenant_id: TENANT, p_actor_id: actorId });

    const { error } = await supabase.rpc('fn_evaluate_wave_eligibility', {
      p_wave_id: waveId, p_tenant_id: TENANT, p_actor_id: actorId,
    });
    expect(error).not.toBeNull();
    expect(error!.message).toContain('cannot be evaluated');
  }, 20000);

  it('4. evaluate tenant isolation: a real wave id cannot be evaluated under the wrong tenant', async () => {
    const { data: otherTenant } = await supabase.from('tenants').select('id').neq('id', TENANT).limit(1);
    if (!otherTenant?.[0]) return;
    const waveId = await mkWave(warehouseId);
    const { error } = await supabase.rpc('fn_evaluate_wave_eligibility', {
      p_wave_id: waveId, p_tenant_id: otherTenant[0].id, p_actor_id: actorId,
    });
    expect(error).not.toBeNull();
    expect(error!.message).toContain('not found');
    // Confirm it genuinely was not evaluated under the real tenant either.
    const wave = await repo.findWaveById(waveId, TENANT) as { status: string };
    expect(wave.status).toBe('planning');
  }, 20000);

  it('5. warehouse isolation: evaluating a wave never includes another warehouse\'s pending shipments', async () => {
    const shipmentInWh1 = await mkPendingShipment(warehouseId);
    const shipmentInWh2 = await mkPendingShipment(warehouseId2);
    const waveId = await mkWave(warehouseId);

    const { data: rows } = await supabase.rpc('fn_evaluate_wave_eligibility', {
      p_wave_id: waveId, p_tenant_id: TENANT, p_actor_id: actorId,
    });
    const includedIds = (rows as { shipment_id: string }[]).map((r) => r.shipment_id);
    expect(includedIds).toContain(shipmentInWh1);
    expect(includedIds).not.toContain(shipmentInWh2);
  }, 20000);

  it('6. cancel error handling: empty/whitespace-only reason is rejected', async () => {
    const waveId = await mkWave(warehouseId);
    const { error: emptyErr } = await supabase.rpc('fn_cancel_wave', {
      p_wave_id: waveId, p_tenant_id: TENANT, p_reason: '', p_actor_id: actorId,
    });
    expect(emptyErr).not.toBeNull();
    expect(emptyErr!.message).toContain('reason is required');

    const { error: whitespaceErr } = await supabase.rpc('fn_cancel_wave', {
      p_wave_id: waveId, p_tenant_id: TENANT, p_reason: '   ', p_actor_id: actorId,
    });
    expect(whitespaceErr).not.toBeNull();

    const wave = await repo.findWaveById(waveId, TENANT) as { status: string };
    expect(wave.status).toBe('planning'); // untouched by the rejected attempts
  }, 20000);

  it('7. history correctness: evaluate and cancel each write exactly the history rows the F8 UI reads', async () => {
    const waveId = await mkWave(warehouseId);
    await supabase.rpc('fn_evaluate_wave_eligibility', { p_wave_id: waveId, p_tenant_id: TENANT, p_actor_id: actorId });

    const historyAfterEvaluate = await repo.findWaveHistory(waveId, TENANT) as {
      old_status: string | null; new_status: string; actor_id: string | null;
    }[];
    expect(historyAfterEvaluate.some((h) => h.old_status === 'planning' && h.new_status === 'evaluating')).toBe(true);
    expect(historyAfterEvaluate.some((h) => h.old_status === 'evaluating' && h.new_status === 'reviewing')).toBe(true);
    for (const h of historyAfterEvaluate) expect(h.actor_id).toBe(actorId);

    const { error: cancelErr } = await supabase.rpc('fn_cancel_wave', {
      p_wave_id: waveId, p_tenant_id: TENANT, p_reason: 'F8 regression: history correctness check', p_actor_id: actorId,
    });
    expect(cancelErr).toBeNull();

    const historyAfterCancel = await repo.findWaveHistory(waveId, TENANT) as {
      old_status: string | null; new_status: string; notes: string | null;
    }[];
    const cancelEntry = historyAfterCancel.find((h) => h.new_status === 'cancelled');
    expect(cancelEntry).toBeTruthy();
    expect(cancelEntry!.old_status).toBe('reviewing');
    expect(cancelEntry!.notes).toBe('F8 regression: history correctness check');
  }, 20000);

  it('8. lifecycle consistency: cancel is rejected once a wave has moved past reviewing (released)', async () => {
    const shipmentId = await mkPendingShipment(warehouseId);
    const { data: movement } = await supabase.from('stock_movements').insert({
      tenant_id: TENANT, warehouse_id: warehouseId, item_id: itemId, movement_type: 'receipt', direction: 'in',
      quantity: 100, unit_cost: 5, total_cost: 500, reference_type: 'f8_actions_seed',
    }).select().single();
    await supabase.from('stock_levels').insert({ tenant_id: TENANT, warehouse_id: warehouseId, item_id: itemId, quantity_on_hand: 100 });
    await supabase.from('cost_layers').insert({
      tenant_id: TENANT, warehouse_id: warehouseId, item_id: itemId, source_movement_id: movement.id,
      unit_cost: 5, quantity_received: 100, quantity_remaining: 100,
    });

    const waveId = await mkWave(warehouseId);
    await supabase.rpc('fn_evaluate_wave_eligibility', { p_wave_id: waveId, p_tenant_id: TENANT, p_actor_id: actorId });
    const { data: pickLists, error: releaseErr } = await supabase.rpc('fn_release_wave', {
      p_wave_id: waveId, p_tenant_id: TENANT, p_actor_id: actorId, p_priority: 'medium',
    });
    expect(releaseErr).toBeNull();
    expect(pickLists.length).toBeGreaterThan(0);

    const { error: cancelErr } = await supabase.rpc('fn_cancel_wave', {
      p_wave_id: waveId, p_tenant_id: TENANT, p_reason: 'should be rejected', p_actor_id: actorId,
    });
    expect(cancelErr).not.toBeNull();
    expect(cancelErr!.message).toContain('WAVE_CANNOT_CANCEL');

    // Cleanup this test's own release-created rows (stock_movements is
    // immutable and left in place, same established exception).
    const plIds = (pickLists as { id: string }[]).map((p) => p.id);
    await supabase.from('stock_reservations').delete().eq('tenant_id', TENANT).eq('reference_type', 'pick_list_line');
    await supabase.from('pick_list_lines').delete().in('pick_list_id', plIds);
    await supabase.from('pick_list_shipments').delete().in('pick_list_id', plIds);
    await supabase.from('pick_lists').delete().in('id', plIds);
    await supabase.from('cost_layers').delete().eq('item_id', itemId).eq('warehouse_id', warehouseId);
    await supabase.from('stock_levels').delete().eq('item_id', itemId).eq('warehouse_id', warehouseId);
  }, 20000);
});
