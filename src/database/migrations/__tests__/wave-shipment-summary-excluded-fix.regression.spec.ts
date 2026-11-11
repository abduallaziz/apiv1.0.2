// Regression suite for the fn_wms_wave_shipment_summary excluded-count
// fix (migration 249). Root cause: `excluded_reason ->> 'reason' <>
// 'claim_failed_at_release'` is not NULL-safe — real evaluation-time
// exclusions never carry a 'reason' key, so the old `<>` comparison
// silently dropped them from the 'excluded' count. Fixed with
// `IS DISTINCT FROM`. This suite calls the real RPC directly against
// real wave_shipments rows (both real evaluator-written rows via
// fn_evaluate_wave_eligibility, and direct inserts mirroring
// fn_release_wave's exact claim_failed_at_release shape, matching the
// established convention of testing query/aggregate logic via direct
// fixtures while lifecycle RPCs are covered elsewhere).
//
// Each test gets its OWN dedicated warehouse: fn_evaluate_wave_
// eligibility evaluates every real pending shipment in a wave's
// warehouse, so sharing one warehouse across tests would let an earlier
// test's still-pending shipments leak into a later test's evaluation and
// inflate its counts — the exact shared-fixture contamination class
// documented elsewhere in this session (F7 stability audit).
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const TENANT = '9bcd3369-d664-47c8-b297-3bc9b429aacf'; // Sefay Demo

describe('fn_wms_wave_shipment_summary excluded-count fix (migration 249)', () => {
  let supabase: SupabaseClient;
  let branchId: string;
  let itemId: string;
  let actorId: string;
  const cleanupWaveIds: string[] = [];
  const cleanupShipmentIds: string[] = [];
  const cleanupWarehouseIds: string[] = [];

  beforeAll(async () => {
    supabase = createClient(
      process.env.SUPABASE_URL as string,
      process.env.SUPABASE_SERVICE_ROLE_KEY as string,
    );

    const { data: wh } = await supabase
      .from('warehouses')
      .select('branch_id')
      .eq('tenant_id', TENANT)
      .limit(1);
    branchId = wh![0].branch_id;

    const { data: user } = await supabase.from('users').select('id').eq('tenant_id', TENANT).limit(1);
    actorId = user![0].id;

    const { data: item, error: itemErr } = await supabase.from('items').insert({
      tenant_id: TENANT, name: 'F9Fix Item', type: 'product', operation_type: 'sell', price: 10, is_active: true,
    }).select().single();
    if (itemErr) throw itemErr;
    itemId = item.id;
  }, 30000);

  afterAll(async () => {
    await supabase.from('wave_shipments').delete().in('wave_id', cleanupWaveIds);
    await supabase.from('waves').delete().in('id', cleanupWaveIds);
    await supabase.from('shipment_lines').delete().in('shipment_id', cleanupShipmentIds);
    await supabase.from('shipments').delete().in('id', cleanupShipmentIds);
    await supabase.from('items').delete().eq('id', itemId);
    await supabase.from('warehouses').delete().in('id', cleanupWarehouseIds);
  }, 30000);

  const mkWarehouse = async () => {
    const { data: wh, error } = await supabase.from('warehouses').insert({
      tenant_id: TENANT, branch_id: branchId, name: 'F9Fix Isolated WH', code: `F9FIX-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    }).select().single();
    if (error) throw error;
    cleanupWarehouseIds.push(wh.id);
    return wh.id as string;
  };

  const mkShipment = async (whId: string, overrides: Record<string, unknown> = {}) => {
    const { data: shipment, error } = await supabase.from('shipments').insert({
      tenant_id: TENANT, warehouse_id: whId, reference_type: 'order', reference_id: crypto.randomUUID(),
      status: 'pending', ...overrides,
    }).select().single();
    if (error) throw error;
    cleanupShipmentIds.push(shipment.id);
    await supabase.from('shipment_lines').insert({ tenant_id: TENANT, shipment_id: shipment.id, item_id: itemId, quantity_requested: 1 });
    return shipment.id as string;
  };

  const mkWave = async (whId: string, criteria: Record<string, unknown> = {}) => {
    const { data: wave, error } = await supabase.from('waves').insert({
      tenant_id: TENANT, warehouse_id: whId, status: 'planning', criteria,
    }).select().single();
    if (error) throw error;
    cleanupWaveIds.push(wave.id);
    return wave.id as string;
  };

  const evaluate = async (waveId: string) => {
    const { error } = await supabase.rpc('fn_evaluate_wave_eligibility', { p_wave_id: waveId, p_tenant_id: TENANT, p_actor_id: actorId });
    if (error) throw error;
  };

  it('1. evaluation exclusion by route is counted as excluded', async () => {
    const whId = await mkWarehouse();
    await mkShipment(whId, { route: 'WEST' });
    const waveId = await mkWave(whId, { route: 'EAST' });
    await evaluate(waveId);

    const { data } = await supabase.rpc('fn_wms_wave_shipment_summary', { p_wave_id: waveId, p_tenant_id: TENANT });
    expect(data.excluded).toBe(1);
    expect(data.eligible).toBe(0);
    expect(data.failed_at_release).toBe(0);
  }, 20000);

  it('2. evaluation exclusion by priority is counted as excluded', async () => {
    const whId = await mkWarehouse();
    await mkShipment(whId, { priority: 'low' });
    const waveId = await mkWave(whId, { priority_min: 'high' });
    await evaluate(waveId);

    const { data } = await supabase.rpc('fn_wms_wave_shipment_summary', { p_wave_id: waveId, p_tenant_id: TENANT });
    expect(data.excluded).toBe(1);
    expect(data.eligible).toBe(0);
  }, 20000);

  it('3. inventory-readiness exclusion is counted as excluded', async () => {
    const whId = await mkWarehouse();
    // No stock seeded for this item at all -> quantity_available 0 < requested.
    await mkShipment(whId);
    const waveId = await mkWave(whId, { require_inventory_ready: 'true' });
    await evaluate(waveId);

    const { data } = await supabase.rpc('fn_wms_wave_shipment_summary', { p_wave_id: waveId, p_tenant_id: TENANT });
    expect(data.excluded).toBe(1);
    expect(data.eligible).toBe(0);
  }, 20000);

  it('4. claim_failed_at_release exclusion is counted separately, not under excluded', async () => {
    const whId = await mkWarehouse();
    const shipmentId = await mkShipment(whId);
    const waveId = await mkWave(whId);
    // Direct fixture mirroring fn_release_wave's exact real shape
    // (migration 238) for a shipment that was included at evaluation but
    // lost the claim race at release — never re-deriving business
    // meaning, just reproducing the real documented column shape.
    await supabase.from('wave_shipments').insert({
      tenant_id: TENANT, wave_id: waveId, shipment_id: shipmentId,
      included_reason: null,
      excluded_reason: { reason: 'claim_failed_at_release', shipment_status_at_release: 'picking', claimed_by_other_wave_id: crypto.randomUUID() },
    });

    const { data } = await supabase.rpc('fn_wms_wave_shipment_summary', { p_wave_id: waveId, p_tenant_id: TENANT });
    expect(data.failed_at_release).toBe(1);
    expect(data.excluded).toBe(0); // not double-counted under excluded
    expect(data.eligible).toBe(0);
  }, 20000);

  it('5. an included (eligible) shipment is never counted as excluded', async () => {
    const whId = await mkWarehouse();
    await mkShipment(whId, { route: 'EAST' });
    const waveId = await mkWave(whId, { route: 'EAST' });
    await evaluate(waveId);

    const { data } = await supabase.rpc('fn_wms_wave_shipment_summary', { p_wave_id: waveId, p_tenant_id: TENANT });
    expect(data.eligible).toBe(1);
    expect(data.excluded).toBe(0);
    expect(data.failed_at_release).toBe(0);
  }, 20000);

  it('6. multiple excluded shipments are all counted, alongside a mix of eligible and claim-failed', async () => {
    const whId = await mkWarehouse();
    await mkShipment(whId, { route: 'WEST' }); // excluded (evaluation)
    await mkShipment(whId, { route: 'WEST' }); // excluded (evaluation)
    const matchingShipmentId = await mkShipment(whId, { route: 'EAST' }); // eligible
    const waveId = await mkWave(whId, { route: 'EAST' });
    await evaluate(waveId);

    // Simulate a 4th, separately-inserted claim-failure row for the same wave.
    const otherShipmentId = await mkShipment(whId, { route: 'EAST' });
    await supabase.from('wave_shipments').insert({
      tenant_id: TENANT, wave_id: waveId, shipment_id: otherShipmentId,
      included_reason: null,
      excluded_reason: { reason: 'claim_failed_at_release', shipment_status_at_release: 'picking', claimed_by_other_wave_id: crypto.randomUUID() },
    });

    const { data } = await supabase.rpc('fn_wms_wave_shipment_summary', { p_wave_id: waveId, p_tenant_id: TENANT });
    expect(data.excluded).toBe(2);
    expect(data.eligible).toBe(1);
    expect(data.failed_at_release).toBe(1);
    const shipmentIds = (data.shipments as { shipment_id: string }[]).map((s) => s.shipment_id);
    expect(shipmentIds).toContain(matchingShipmentId);
  }, 20000);

  it('7. tenant isolation: the fix does not leak counts across tenants', async () => {
    const { data: otherTenant } = await supabase.from('tenants').select('id').neq('id', TENANT).limit(1);
    if (!otherTenant?.[0]) return;
    const whId = await mkWarehouse();
    await mkShipment(whId, { route: 'WEST' });
    const waveId = await mkWave(whId, { route: 'EAST' });
    await evaluate(waveId);

    const { data } = await supabase.rpc('fn_wms_wave_shipment_summary', { p_wave_id: waveId, p_tenant_id: otherTenant[0].id });
    expect(data.excluded).toBe(0);
    expect(data.eligible).toBe(0);
    expect(data.shipments).toHaveLength(0);
  }, 20000);

  it('8. warehouse isolation: excluded counts are scoped to the wave\'s own warehouse shipments only', async () => {
    const whId = await mkWarehouse();
    const wh2Id = await mkWarehouse();
    // A shipment in a DIFFERENT warehouse must never be evaluated by this
    // wave at all (fn_evaluate_wave_eligibility scopes strictly by
    // v_wave.warehouse_id), so it can't appear in either count.
    await mkShipment(wh2Id, { route: 'WEST' });
    await mkShipment(whId, { route: 'WEST' }); // this wave's own warehouse, excluded
    const waveId = await mkWave(whId, { route: 'EAST' });
    await evaluate(waveId);

    const { data } = await supabase.rpc('fn_wms_wave_shipment_summary', { p_wave_id: waveId, p_tenant_id: TENANT });
    expect(data.excluded).toBe(1); // only the same-warehouse shipment
  }, 20000);
});
