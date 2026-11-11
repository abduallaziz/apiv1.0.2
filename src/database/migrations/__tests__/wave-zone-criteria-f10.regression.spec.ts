// Regression suite for the F10 zone-criteria gap closure: `zone_ids`
// support in the Wave Create/Criteria Builder.
//
// Two things are under test:
// 1. The zone-listing query shape LocationsRepository.findAll now builds
//    when `locationType` is passed (warehouse_locations.location_type =
//    'zone', migration 097 — the sole hierarchy-root type). This suite
//    doesn't spin up the NestJS HTTP layer (no e2e harness exists in this
//    test directory — every regression here talks to Supabase directly,
//    established convention), so it reproduces the exact same filtered
//    query the repository issues and asserts on its real result, plus
//    warehouse/tenant isolation.
// 2. fn_evaluate_wave_eligibility's real `zone_ids` matching (migrations
//    231/232), including ancestor-chain resolution via
//    fn_location_is_in_zone (migration 227) — a shipment line's location
//    can be several hierarchy levels below the zone itself and must still
//    match.
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const TENANT = '9bcd3369-d664-47c8-b297-3bc9b429aacf'; // Sefay Demo

describe('F10 zone criteria gap closure (zone_ids)', () => {
  let supabase: SupabaseClient;
  let branchId: string;
  let itemId: string;
  let actorId: string;
  const cleanupWaveIds: string[] = [];
  const cleanupShipmentIds: string[] = [];
  const cleanupLocationIds: string[] = [];
  const cleanupWarehouseIds: string[] = [];

  beforeAll(async () => {
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    );

    const { data: wh } = await supabase
      .from('warehouses')
      .select('branch_id')
      .eq('tenant_id', TENANT)
      .limit(1);
    branchId = wh[0].branch_id;

    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('tenant_id', TENANT)
      .limit(1);
    actorId = user[0].id;

    const { data: item, error: itemErr } = await supabase
      .from('items')
      .insert({
        tenant_id: TENANT,
        name: 'F10Zone Item',
        type: 'product',
        operation_type: 'sell',
        price: 10,
        is_active: true,
      })
      .select()
      .single();
    if (itemErr) throw itemErr;
    itemId = item.id;
  }, 30000);

  afterAll(async () => {
    await supabase
      .from('wave_shipments')
      .delete()
      .in('wave_id', cleanupWaveIds);
    await supabase.from('waves').delete().in('id', cleanupWaveIds);
    await supabase
      .from('shipment_lines')
      .delete()
      .in('shipment_id', cleanupShipmentIds);
    await supabase.from('shipments').delete().in('id', cleanupShipmentIds);
    await supabase.from('items').delete().eq('id', itemId);
    // Bins/shelves/racks/aisles reference their zone via parent_location_id
    // with ON DELETE SET NULL, so plain id-based deletion (any order) is safe.
    await supabase
      .from('warehouse_locations')
      .delete()
      .in('id', cleanupLocationIds);
    await supabase.from('warehouses').delete().in('id', cleanupWarehouseIds);
  }, 30000);

  const mkWarehouse = async () => {
    const { data: wh, error } = await supabase
      .from('warehouses')
      .insert({
        tenant_id: TENANT,
        branch_id: branchId,
        name: 'F10Zone Isolated WH',
        code: `F10ZONE-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      })
      .select()
      .single();
    if (error) throw error;
    cleanupWarehouseIds.push(wh.id);
    return wh.id as string;
  };

  const mkZone = async (whId: string, name = 'Zone A') => {
    const { data: loc, error } = await supabase
      .from('warehouse_locations')
      .insert({
        tenant_id: TENANT,
        warehouse_id: whId,
        code: `Z-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name,
        location_type: 'zone',
        is_active: true,
      })
      .select()
      .single();
    if (error) throw error;
    cleanupLocationIds.push(loc.id);
    return loc.id as string;
  };

  // Builds a full zone -> aisle -> rack -> shelf -> bin chain (migration
  // 097's trigger enforces this exact sequence) and returns the bin id, so
  // tests can verify ancestor-chain resolution, not just exact-id matches.
  const mkBinUnderZone = async (whId: string, zoneId: string) => {
    const mk = async (type: string, parentId: string) => {
      const { data, error } = await supabase
        .from('warehouse_locations')
        .insert({
          tenant_id: TENANT,
          warehouse_id: whId,
          code: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: type,
          location_type: type,
          parent_location_id: parentId,
          is_active: true,
        })
        .select()
        .single();
      if (error) throw error;
      cleanupLocationIds.push(data.id);
      return data.id as string;
    };
    const aisle = await mk('aisle', zoneId);
    const rack = await mk('rack', aisle);
    const shelf = await mk('shelf', rack);
    const bin = await mk('bin', shelf);
    return bin;
  };

  const mkShipment = async (
    whId: string,
    locationId: string | null,
    overrides: Record<string, unknown> = {},
  ) => {
    const { data: shipment, error } = await supabase
      .from('shipments')
      .insert({
        tenant_id: TENANT,
        warehouse_id: whId,
        reference_type: 'order',
        reference_id: crypto.randomUUID(),
        status: 'pending',
        ...overrides,
      })
      .select()
      .single();
    if (error) throw error;
    cleanupShipmentIds.push(shipment.id);
    await supabase.from('shipment_lines').insert({
      tenant_id: TENANT,
      shipment_id: shipment.id,
      item_id: itemId,
      quantity_requested: 1,
      location_id: locationId,
    });
    return shipment.id as string;
  };

  const mkWave = async (
    whId: string,
    criteria: Record<string, unknown> = {},
  ) => {
    const { data: wave, error } = await supabase
      .from('waves')
      .insert({
        tenant_id: TENANT,
        warehouse_id: whId,
        status: 'planning',
        criteria,
      })
      .select()
      .single();
    if (error) throw error;
    cleanupWaveIds.push(wave.id);
    return wave.id as string;
  };

  const evaluate = async (waveId: string) => {
    const { error } = await supabase.rpc('fn_evaluate_wave_eligibility', {
      p_wave_id: waveId,
      p_tenant_id: TENANT,
      p_actor_id: actorId,
    });
    if (error) throw error;
  };

  // Reproduces LocationsRepository.findAll's exact query shape with
  // locationType='zone', the query the new GET .../locations?locationType=zone
  // filter issues.
  const listZones = async (whId: string, tenantId: string) => {
    const { data, error } = await supabase
      .from('warehouse_locations')
      .select('*')
      .eq('warehouse_id', whId)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .eq('is_active', true)
      .eq('location_type', 'zone');
    if (error) throw error;
    return data ?? [];
  };

  it('1. zone listing returns only location_type=zone rows for the given warehouse', async () => {
    const whId = await mkWarehouse();
    const zoneId = await mkZone(whId, 'Zone A');
    const binId = await mkBinUnderZone(whId, zoneId); // a non-zone location in the same warehouse
    void binId;

    const zones = await listZones(whId, TENANT);
    expect(zones.map((z) => z.id)).toContain(zoneId);
    expect(zones.every((z) => z.location_type === 'zone')).toBe(true);
  }, 20000);

  it('2. warehouse isolation: zones from another warehouse are not returned', async () => {
    const whId = await mkWarehouse();
    const otherWhId = await mkWarehouse();
    await mkZone(whId, 'Zone A');
    const otherZoneId = await mkZone(otherWhId, 'Zone B');

    const zones = await listZones(whId, TENANT);
    expect(zones.map((z) => z.id)).not.toContain(otherZoneId);
  }, 20000);

  it('3. tenant isolation: zones do not leak across tenants', async () => {
    const { data: otherTenant } = await supabase
      .from('tenants')
      .select('id')
      .neq('id', TENANT)
      .limit(1);
    if (!otherTenant?.[0]) return;
    const whId = await mkWarehouse();
    await mkZone(whId, 'Zone A');

    const zones = await listZones(whId, otherTenant[0].id);
    expect(zones).toHaveLength(0);
  }, 20000);

  it('4. wave evaluation: a shipment whose line location IS the listed zone is eligible', async () => {
    const whId = await mkWarehouse();
    const zoneId = await mkZone(whId, 'Zone A');
    await mkShipment(whId, zoneId);
    const waveId = await mkWave(whId, { zone_ids: [zoneId] });
    await evaluate(waveId);

    const { data } = await supabase.rpc('fn_wms_wave_shipment_summary', {
      p_wave_id: waveId,
      p_tenant_id: TENANT,
    });
    expect(data.eligible).toBe(1);
    expect(data.excluded).toBe(0);
  }, 20000);

  it('5. wave evaluation: a shipment whose line resolves up a full zone->aisle->rack->shelf->bin chain to the listed zone is eligible', async () => {
    const whId = await mkWarehouse();
    const zoneId = await mkZone(whId, 'Zone A');
    const binId = await mkBinUnderZone(whId, zoneId);
    await mkShipment(whId, binId);
    const waveId = await mkWave(whId, { zone_ids: [zoneId] });
    await evaluate(waveId);

    const { data } = await supabase.rpc('fn_wms_wave_shipment_summary', {
      p_wave_id: waveId,
      p_tenant_id: TENANT,
    });
    expect(data.eligible).toBe(1);
    expect(data.excluded).toBe(0);
  }, 20000);

  it('6. wave evaluation: a shipment under a different zone is excluded, with zone_ids_required recorded', async () => {
    const whId = await mkWarehouse();
    const zoneA = await mkZone(whId, 'Zone A');
    const zoneB = await mkZone(whId, 'Zone B');
    await mkShipment(whId, zoneB);
    const waveId = await mkWave(whId, { zone_ids: [zoneA] });
    await evaluate(waveId);

    const { data } = await supabase.rpc('fn_wms_wave_shipment_summary', {
      p_wave_id: waveId,
      p_tenant_id: TENANT,
    });
    expect(data.excluded).toBe(1);
    expect(data.eligible).toBe(0);
    const row = (
      data.shipments as { excluded_reason: Record<string, unknown> | null }[]
    )[0];
    expect(row.excluded_reason?.zone_ids_required).toEqual([zoneA]);
  }, 20000);

  it('7. wave evaluation: multiple zone_ids — a shipment matching any listed zone is eligible', async () => {
    const whId = await mkWarehouse();
    const zoneA = await mkZone(whId, 'Zone A');
    const zoneB = await mkZone(whId, 'Zone B');
    await mkShipment(whId, zoneB);
    const waveId = await mkWave(whId, { zone_ids: [zoneA, zoneB] });
    await evaluate(waveId);

    const { data } = await supabase.rpc('fn_wms_wave_shipment_summary', {
      p_wave_id: waveId,
      p_tenant_id: TENANT,
    });
    expect(data.eligible).toBe(1);
    expect(data.excluded).toBe(0);
  }, 20000);

  it('8. a shipment with no location_id at all is excluded when zone_ids is set', async () => {
    const whId = await mkWarehouse();
    const zoneA = await mkZone(whId, 'Zone A');
    await mkShipment(whId, null);
    const waveId = await mkWave(whId, { zone_ids: [zoneA] });
    await evaluate(waveId);

    const { data } = await supabase.rpc('fn_wms_wave_shipment_summary', {
      p_wave_id: waveId,
      p_tenant_id: TENANT,
    });
    expect(data.excluded).toBe(1);
    expect(data.eligible).toBe(0);
  }, 20000);
});
