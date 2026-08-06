/**
 * Regression suite for Migration 13.13-fix (Expired Batch Advisory Warning, #13).
 * Runs directly against the real shared Supabase project via the
 * service-role client — same convention as every other regression spec in
 * this directory. Exercises the new fn_check_expired_batches RPC and
 * ExpiredBatchesRepository directly (the actual integration point added to
 * InvoicesService), plus confirms fn_check_quality_holds (advisory
 * precedent this mirrors) and fn_consume_cost_layers' FEFO ordering
 * (migration 108) remain unaffected.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

import { ExpiredBatchesRepository } from '../../../modules/inventory/repositories/expired-batches.repository';

const TEST_TENANT_ID = '9bcd3369-d664-47c8-b297-3bc9b429aacf'; // Sefay Demo
const OTHER_TENANT_ID = '00000000-0000-0000-0000-000000000003';

describe('expired batch advisory warning regression (Migration 13.13-fix)', () => {
  let supabase: SupabaseClient;
  let repo: ExpiredBatchesRepository;
  let warehouseId: string;
  let itemExpired: string;
  let itemFresh: string;
  const itemIds: string[] = [];
  const batchIds: string[] = [];

  beforeAll(async () => {
    supabase = createClient(process.env.SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string);
    repo = new ExpiredBatchesRepository(supabase);

    const { data: wh, error: whErr } = await supabase
      .from('warehouses')
      .select('id')
      .eq('tenant_id', TEST_TENANT_ID)
      .limit(1)
      .single();
    if (whErr) throw whErr;
    warehouseId = wh.id;

    const { data: iExp, error: iExpErr } = await supabase
      .from('items')
      .insert({ tenant_id: TEST_TENANT_ID, name: 'Regr 13.13-fix Expired Item', type: 'product', operation_type: 'sell', price: 10, track_batches: true, is_active: true })
      .select()
      .single();
    if (iExpErr) throw iExpErr;
    itemExpired = iExp.id;
    itemIds.push(itemExpired);

    const { data: iFresh, error: iFreshErr } = await supabase
      .from('items')
      .insert({ tenant_id: TEST_TENANT_ID, name: 'Regr 13.13-fix Fresh Item', type: 'product', operation_type: 'sell', price: 10, track_batches: true, is_active: true })
      .select()
      .single();
    if (iFreshErr) throw iFreshErr;
    itemFresh = iFresh.id;
    itemIds.push(itemFresh);

    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const nextYear = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);

    const { data: expiredBatch, error: ebErr } = await supabase
      .from('item_batches')
      .insert({ tenant_id: TEST_TENANT_ID, item_id: itemExpired, batch_number: `R1313-EXP-${Date.now()}`, expiration_date: yesterday })
      .select()
      .single();
    if (ebErr) throw ebErr;
    batchIds.push(expiredBatch.id);

    const { data: freshBatch, error: fbErr } = await supabase
      .from('item_batches')
      .insert({ tenant_id: TEST_TENANT_ID, item_id: itemFresh, batch_number: `R1313-FRESH-${Date.now()}`, expiration_date: nextYear })
      .select()
      .single();
    if (fbErr) throw fbErr;
    batchIds.push(freshBatch.id);

    // cost_layers rows with quantity_remaining > 0 are what the RPC actually
    // scans (mirrors real stock — a batch with zero remaining stock should
    // never surface as a warning, same reasoning fn_consume_cost_layers uses).
    await supabase.from('cost_layers').insert([
      { tenant_id: TEST_TENANT_ID, warehouse_id: warehouseId, item_id: itemExpired, batch_id: expiredBatch.id, unit_cost: 5, quantity_received: 10, quantity_remaining: 10 },
      { tenant_id: TEST_TENANT_ID, warehouse_id: warehouseId, item_id: itemFresh, batch_id: freshBatch.id, unit_cost: 5, quantity_received: 10, quantity_remaining: 10 },
    ]);
  }, 30_000);

  afterAll(async () => {
    await supabase.from('cost_layers').delete().in('item_id', itemIds);
    await supabase.from('item_batches').delete().in('id', batchIds);
    for (const id of itemIds) {
      await supabase.from('items').delete().eq('id', id);
    }
  }, 30_000);

  it('Test 1: sale with only a non-expired batch — no warning', async () => {
    const result = await repo.checkExpiredBatches(TEST_TENANT_ID, warehouseId, [
      { item_id: itemFresh, variant_id: null },
    ]);
    expect(result).toEqual([]);
  }, 15_000);

  it('Test 2: sale with an expired batch — warning detected, sale is not blocked at this layer', async () => {
    const result = await repo.checkExpiredBatches(TEST_TENANT_ID, warehouseId, [
      { item_id: itemExpired, variant_id: null },
    ]);
    expect(result.length).toBe(1);
    expect(result[0].item_name).toBe('Regr 13.13-fix Expired Item');
    expect(result[0].batch_id).toBe(batchIds[0]);
    // The RPC itself never raises/throws — it is a pure SELECT, confirming
    // there is no code path here that could block a sale.
  }, 15_000);

  it('Test 3: multiple items in one sale — only the expired one is flagged', async () => {
    const result = await repo.checkExpiredBatches(TEST_TENANT_ID, warehouseId, [
      { item_id: itemExpired, variant_id: null },
      { item_id: itemFresh, variant_id: null },
    ]);
    expect(result.length).toBe(1);
    expect(result[0].item_id).toBe(itemExpired);
  }, 15_000);

  it('Test 4: tenant isolation — another tenant cannot detect this tenant\'s expired batch', async () => {
    const result = await repo.checkExpiredBatches(OTHER_TENANT_ID, warehouseId, [
      { item_id: itemExpired, variant_id: null },
    ]);
    expect(result).toEqual([]);
  }, 15_000);

  it('Test 5: existing Quality Holds advisory RPC is unaffected', async () => {
    const { data, error } = await supabase.rpc('fn_check_quality_holds', {
      p_tenant_id: TEST_TENANT_ID,
      p_warehouse_id: warehouseId,
      p_items: [{ item_id: itemFresh, variant_id: null }],
    });
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true); // still a plain, non-throwing read — unchanged shape/behavior
  }, 15_000);

  it('Test 6: FEFO consumption ordering is unchanged — soonest-expiring layer still consumed first', async () => {
    const soon = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
    const later = new Date(Date.now() + 100 * 86400000).toISOString().slice(0, 10);

    const { data: item, error: itemErr } = await supabase
      .from('items')
      .insert({ tenant_id: TEST_TENANT_ID, name: 'Regr 13.13-fix FEFO Item', type: 'product', operation_type: 'sell', price: 10, track_batches: true, is_active: true })
      .select()
      .single();
    if (itemErr) throw itemErr;

    const { data: batchSoon } = await supabase
      .from('item_batches')
      .insert({ tenant_id: TEST_TENANT_ID, item_id: item.id, batch_number: `R1313-FEFO-SOON-${Date.now()}`, expiration_date: soon })
      .select()
      .single();
    const { data: batchLater } = await supabase
      .from('item_batches')
      .insert({ tenant_id: TEST_TENANT_ID, item_id: item.id, batch_number: `R1313-FEFO-LATER-${Date.now()}`, expiration_date: later })
      .select()
      .single();

    // Later-expiring layer received first (older received_at) — under pure
    // FIFO this would be consumed first; under FEFO the soon-to-expire layer
    // (received second) must be consumed first instead.
    const { data: layerLater } = await supabase
      .from('cost_layers')
      .insert({ tenant_id: TEST_TENANT_ID, warehouse_id: warehouseId, item_id: item.id, batch_id: batchLater.id, unit_cost: 5, quantity_received: 10, quantity_remaining: 10, received_at: new Date(Date.now() - 100000).toISOString() })
      .select()
      .single();
    const { data: layerSoon } = await supabase
      .from('cost_layers')
      .insert({ tenant_id: TEST_TENANT_ID, warehouse_id: warehouseId, item_id: item.id, batch_id: batchSoon.id, unit_cost: 5, quantity_received: 10, quantity_remaining: 10, received_at: new Date().toISOString() })
      .select()
      .single();

    const { data: consumedUnitCost, error: consumeErr } = await supabase.rpc('fn_consume_cost_layers', {
      p_tenant_id: TEST_TENANT_ID,
      p_warehouse_id: warehouseId,
      p_item_id: item.id,
      p_variant_id: null,
      p_quantity: 5,
    });
    expect(consumeErr).toBeNull();
    expect(Number(consumedUnitCost)).toBe(5);

    const { data: afterSoon } = await supabase.from('cost_layers').select('quantity_remaining').eq('id', layerSoon.id).single();
    const { data: afterLater } = await supabase.from('cost_layers').select('quantity_remaining').eq('id', layerLater.id).single();
    expect(Number(afterSoon!.quantity_remaining)).toBe(5); // the soon-expiring layer was drawn from first
    expect(Number(afterLater!.quantity_remaining)).toBe(10); // the later-expiring layer was untouched

    await supabase.from('cost_layers').delete().in('id', [layerSoon.id, layerLater.id]);
    await supabase.from('item_batches').delete().in('id', [batchSoon.id, batchLater.id]);
    await supabase.from('items').delete().eq('id', item.id);
  }, 30_000);
});
