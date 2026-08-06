/**
 * Regression suite for Migration 13.12-fix (Inventory Counting Completion, #12):
 * (1) count_type (full/partial/cycle) with scoped item/location selection,
 * (2) reason_code_id wired into count-item submission,
 * (3) a threshold-based approval gate mirroring AdjustmentsService's pattern.
 * Runs directly against the real shared Supabase project via the
 * service-role client, exercising the real CountsService class directly —
 * same convention as this session's other 13.x-fix regression specs
 * (e.g. inventory-rules-13.6-fix, transfers 13.6-fix).
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

import { CountsService } from '../../../modules/inventory/counts.service';
import { CountsRepository } from '../../../modules/inventory/repositories/counts.repository';
import { ApprovalEngine } from '../../../engines/approval-engine/approval.engine';
import { ApprovalHistoryRepository } from '../../../engines/approval-engine/approval-history.repository';

const TEST_TENANT_ID = '9bcd3369-d664-47c8-b297-3bc9b429aacf'; // Sefay Demo
const OTHER_TENANT_ID = '00000000-0000-0000-0000-000000000002';

function fakeConfig(threshold: number) {
  return { get: (key: string) => (key === 'INVENTORY_COUNT_APPROVAL_THRESHOLD' ? String(threshold) : undefined) } as any;
}

// invalidateStockCache is a fire-and-forget cache-clear with no assertions
// relevant to this suite — a no-op stub avoids wiring a real Redis client
// just to satisfy the constructor.
function fakeStockService() {
  return { invalidateStockCache: async () => undefined } as any;
}

function makeCountsService(threshold: number, countsRepo: CountsRepository) {
  return new CountsService(
    countsRepo,
    fakeStockService(),
    new ApprovalEngine(),
    new ApprovalHistoryRepository((countsRepo as any).supabase),
    fakeConfig(threshold),
  );
}

describe('stock count completion regression (Migration 13.12-fix)', () => {
  let supabase: SupabaseClient;
  let countsRepo: CountsRepository;
  let warehouseId: string;
  let itemA: string; // cost_price 50, unscoped location
  let itemB: string; // cost_price 10, scoped location
  let locationId: string;
  let reasonCodeId: string;
  const countIds: string[] = [];
  const itemIds: string[] = [];

  beforeAll(async () => {
    supabase = createClient(process.env.SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string);
    countsRepo = new CountsRepository(supabase);

    const { data: wh, error: whErr } = await supabase
      .from('warehouses')
      .select('id')
      .eq('tenant_id', TEST_TENANT_ID)
      .limit(1)
      .single();
    if (whErr) throw whErr;
    warehouseId = wh.id;

    const { data: loc, error: locErr } = await supabase
      .from('warehouse_locations')
      .insert({ tenant_id: TEST_TENANT_ID, warehouse_id: warehouseId, code: `R1312-LOC-${Date.now()}`, name: 'Regr Loc', location_type: 'zone' })
      .select()
      .single();
    if (locErr) throw locErr;
    locationId = loc.id;

    const { data: iA, error: iAErr } = await supabase
      .from('items')
      .insert({ tenant_id: TEST_TENANT_ID, name: 'Regr 13.12-fix Item A', type: 'product', operation_type: 'sell', price: 20, cost_price: 50, is_active: true })
      .select()
      .single();
    if (iAErr) throw iAErr;
    itemA = iA.id;
    itemIds.push(itemA);

    const { data: iB, error: iBErr } = await supabase
      .from('items')
      .insert({ tenant_id: TEST_TENANT_ID, name: 'Regr 13.12-fix Item B', type: 'product', operation_type: 'sell', price: 5, cost_price: 10, is_active: true })
      .select()
      .single();
    if (iBErr) throw iBErr;
    itemB = iB.id;
    itemIds.push(itemB);

    const { data: rc, error: rcErr } = await supabase
      .from('reason_codes')
      .insert({ tenant_id: TEST_TENANT_ID, code: `R1312-${Date.now()}`, label: 'Regression Damage', applies_to: 'count' })
      .select()
      .single();
    if (rcErr) throw rcErr;
    reasonCodeId = rc.id;
  }, 30_000);

  afterAll(async () => {
    for (const id of countIds) {
      await supabase.from('stock_counts').delete().eq('id', id);
    }
    await supabase.from('stock_levels').delete().in('item_id', itemIds);
    await supabase.from('cost_layers').delete().in('item_id', itemIds);
    await supabase.from('reason_codes').delete().eq('id', reasonCodeId);
    await supabase.from('warehouse_locations').delete().eq('id', locationId);
    for (const id of itemIds) {
      await supabase.from('items').delete().eq('id', id);
    }
  }, 60_000);

  const seedLevels = async () => {
    await supabase.from('stock_levels').insert([
      { tenant_id: TEST_TENANT_ID, warehouse_id: warehouseId, item_id: itemA, quantity_on_hand: 10 },
      { tenant_id: TEST_TENANT_ID, warehouse_id: warehouseId, item_id: itemB, location_id: locationId, quantity_on_hand: 5 },
    ]);
    // A shortage variance (counted < expected) consumes cost_layers via
    // fn_consume_cost_layers — seed a matching layer so finalize can source
    // cost for itemA's correction the same way a real goods receipt would.
    await supabase.from('cost_layers').insert({
      tenant_id: TEST_TENANT_ID,
      warehouse_id: warehouseId,
      item_id: itemA,
      unit_cost: 50,
      quantity_received: 10,
      quantity_remaining: 10,
    });
  };
  const clearLevels = async () => {
    await supabase.from('stock_levels').delete().in('item_id', itemIds);
    await supabase.from('cost_layers').delete().in('item_id', itemIds);
  };

  it('Test 1: full count (default, no count_type) behaves exactly as before — includes all seeded items', async () => {
    await seedLevels();
    const service = makeCountsService(0, countsRepo);
    const created: any = await service.create(TEST_TENANT_ID, { warehouse_id: warehouseId, count_number: `R1312-FULL-${Date.now()}` } as any, null as any);
    countIds.push(created.id);
    expect(created.count_type).toBe('full');
    const lineItemIds = (created.items ?? []).map((i: any) => i.item_id);
    expect(lineItemIds).toEqual(expect.arrayContaining([itemA, itemB]));
    await clearLevels();
  }, 30_000);

  it('Test 2: partial count only includes the selected item scope', async () => {
    await seedLevels();
    const service = makeCountsService(0, countsRepo);
    const created: any = await service.create(
      TEST_TENANT_ID,
      { warehouse_id: warehouseId, count_number: `R1312-PARTIAL-${Date.now()}`, count_type: 'partial', item_ids: [itemA] } as any,
      null as any,
    );
    countIds.push(created.id);
    expect(created.count_type).toBe('partial');
    const lineItemIds = (created.items ?? []).map((i: any) => i.item_id);
    expect(lineItemIds).toEqual([itemA]);
    expect(lineItemIds).not.toContain(itemB);
    await clearLevels();
  }, 30_000);

  it('Test 3: cycle count works, scoped by location', async () => {
    await seedLevels();
    const service = makeCountsService(0, countsRepo);
    const created: any = await service.create(
      TEST_TENANT_ID,
      { warehouse_id: warehouseId, count_number: `R1312-CYCLE-${Date.now()}`, count_type: 'cycle', location_ids: [locationId] } as any,
      null as any,
    );
    countIds.push(created.id);
    expect(created.count_type).toBe('cycle');
    const lineItemIds = (created.items ?? []).map((i: any) => i.item_id);
    expect(lineItemIds).toEqual([itemB]); // only itemB was seeded at locationId
    await clearLevels();
  }, 30_000);

  it('Test 3b: partial/cycle without any scope is rejected', () => {
    const service = makeCountsService(0, countsRepo);
    // create() throws synchronously (it's not an async method) — a plain
    // function-call assertion, not .rejects, catches it correctly.
    expect(() =>
      service.create(TEST_TENANT_ID, { warehouse_id: warehouseId, count_number: `R1312-NOSCOPE-${Date.now()}`, count_type: 'partial' } as any, null as any),
    ).toThrow('requires at least one of item_ids or location_ids');
  }, 15_000);

  it('Test 4: variance reason code is stored on the count item, and an invalid reason code is rejected', async () => {
    await seedLevels();
    const service = makeCountsService(0, countsRepo);
    const created: any = await service.create(
      TEST_TENANT_ID,
      { warehouse_id: warehouseId, count_number: `R1312-REASON-${Date.now()}`, count_type: 'partial', item_ids: [itemA] } as any,
      null as any,
    );
    countIds.push(created.id);
    const line = created.items[0];

    const updated: any = await service.submitCount(created.id, line.id, TEST_TENANT_ID, { counted_quantity: 8, reason_code_id: reasonCodeId } as any);
    expect(updated.reason_code_id).toBe(reasonCodeId);

    await expect(
      service.submitCount(created.id, line.id, TEST_TENANT_ID, { counted_quantity: 8, reason_code_id: '00000000-0000-0000-0000-000000000099' } as any),
    ).rejects.toThrow('Reason code not found');

    await clearLevels();
  }, 30_000);

  it('Test 5+6+7: approval-required count enters pending_approval, cannot bypass approval, and can finalize once approved', async () => {
    await seedLevels();
    const threshold = 100; // itemA variance of 5 units * cost_price 50 = 250 >= 100
    const service = makeCountsService(threshold, countsRepo);
    const created: any = await service.create(
      TEST_TENANT_ID,
      { warehouse_id: warehouseId, count_number: `R1312-APPROVAL-${Date.now()}`, count_type: 'partial', item_ids: [itemA] } as any,
      null as any,
    );
    countIds.push(created.id);
    const line = created.items[0];
    await service.submitCount(created.id, line.id, TEST_TENANT_ID, { counted_quantity: 5 } as any); // expected 10 -> variance 5 * 50 = 250

    // Test 5: finalize is blocked and flips the count to pending_approval
    await expect(service.finalize(created.id, TEST_TENANT_ID, null as any)).rejects.toThrow('requires approval before finalizing');
    const afterFirstAttempt: any = await service.findById(created.id, TEST_TENANT_ID);
    expect(afterFirstAttempt.approval_status).toBe('pending_approval');

    // Test 7: the DB-level guard itself independently blocks finalize while pending —
    // call the RPC directly, bypassing the service's own threshold check entirely.
    const { error: directRpcError } = await supabase.rpc('fn_finalize_stock_count', {
      p_stock_count_id: created.id,
      p_actor_id: null,
    });
    expect(directRpcError).not.toBeNull();
    expect(directRpcError?.message).toContain('requires approval before finalizing');

    // Test 6: once approved, finalize succeeds
    await service.approve(created.id, TEST_TENANT_ID, null as any, { approved: true } as any);
    const finalized: any = await service.finalize(created.id, TEST_TENANT_ID, null as any);
    expect(finalized.status).toBe('completed');

    await clearLevels();
  }, 30_000);

  it('Test 8: existing finalize flow without an approval threshold remains unchanged (threshold=0)', async () => {
    await seedLevels();
    const service = makeCountsService(0, countsRepo);
    const created: any = await service.create(
      TEST_TENANT_ID,
      { warehouse_id: warehouseId, count_number: `R1312-NOTHRESH-${Date.now()}`, count_type: 'partial', item_ids: [itemA] } as any,
      null as any,
    );
    countIds.push(created.id);
    const line = created.items[0];
    await service.submitCount(created.id, line.id, TEST_TENANT_ID, { counted_quantity: 5 } as any); // large variance, but threshold disabled

    const finalized: any = await service.finalize(created.id, TEST_TENANT_ID, null as any);
    expect(finalized.status).toBe('completed');
    const reloaded: any = await service.findById(created.id, TEST_TENANT_ID);
    expect(reloaded.approval_status).toBeNull(); // never touched — exact pre-existing behavior

    await clearLevels();
  }, 30_000);

  it('Test 9: tenant isolation — a count/reason-code from another tenant is not accessible', async () => {
    const service = makeCountsService(0, countsRepo);
    // A real count belonging to TEST_TENANT_ID must not be readable under OTHER_TENANT_ID.
    await seedLevels();
    const created: any = await service.create(
      TEST_TENANT_ID,
      { warehouse_id: warehouseId, count_number: `R1312-ISO-${Date.now()}`, count_type: 'partial', item_ids: [itemA] } as any,
      null as any,
    );
    countIds.push(created.id);

    await expect(service.findById(created.id, OTHER_TENANT_ID)).rejects.toThrow('Stock count not found');

    const exists = await countsRepo.reasonCodeExists(reasonCodeId, OTHER_TENANT_ID);
    expect(exists).toBe(false);

    await clearLevels();
  }, 30_000);
});
