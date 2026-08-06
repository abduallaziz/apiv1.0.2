/**
 * Regression suite for Migration 7.1 (Advanced Analytics Phase 1). Runs
 * directly against the real shared Supabase project via the service-role
 * client — same approach as every other regression spec in this directory.
 *
 * Seeds controlled data (known costs, known quantities, known received_at
 * dates) and asserts exact expected numbers from all three new RPCs, rather
 * than just checking "no error" — proving correctness, not just wiring.
 *
 * Not wired into CI — run deliberately via `npm test` when touching this
 * area again.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const TEST_TENANT_ID = '9bcd3369-d664-47c8-b297-3bc9b429aacf'; // Sefay Demo

describe('advanced analytics regression (Migration 7.1)', () => {
  let supabase: SupabaseClient;
  let warehouseId: string;
  const itemIds: string[] = [];
  const grIds: string[] = [];

  const createItem = async (name: string) => {
    const { data, error } = await supabase
      .from('items')
      .insert({ tenant_id: TEST_TENANT_ID, name, type: 'product', operation_type: 'sell', price: 10, is_active: true })
      .select()
      .single();
    if (error) throw error;
    itemIds.push(data.id);
    return data.id;
  };

  const seedStock = async (itemId: string, qty: number, unitCost: number) => {
    const { data: gr, error: grErr } = await supabase
      .from('goods_receipts')
      .insert({
        tenant_id: TEST_TENANT_ID,
        warehouse_id: warehouseId,
        receipt_number: `AA71-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        status: 'draft',
      })
      .select()
      .single();
    if (grErr) throw grErr;
    grIds.push(gr.id);

    const { error: lineErr } = await supabase.from('goods_receipt_items').insert({
      tenant_id: TEST_TENANT_ID,
      goods_receipt_id: gr.id,
      item_id: itemId,
      quantity_received: qty,
      unit_cost: unitCost,
    });
    if (lineErr) throw lineErr;

    const { error: postErr } = await supabase.rpc('fn_post_goods_receipt', {
      p_goods_receipt_id: gr.id,
      p_actor_id: null,
    });
    if (postErr) throw postErr;
  };

  const backdateCostLayer = async (itemId: string, daysAgo: number) => {
    const receivedAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
    const { error } = await supabase
      .from('cost_layers')
      .update({ received_at: receivedAt })
      .eq('tenant_id', TEST_TENANT_ID)
      .eq('item_id', itemId)
      .eq('warehouse_id', warehouseId);
    if (error) throw error;
  };

  const recordSale = async (itemId: string, qty: number) => {
    const { data: unitCost, error: consumeErr } = await supabase.rpc('fn_consume_cost_layers', {
      p_tenant_id: TEST_TENANT_ID,
      p_warehouse_id: warehouseId,
      p_item_id: itemId,
      p_variant_id: null,
      p_quantity: qty,
    });
    if (consumeErr) throw consumeErr;

    const { error: moveErr } = await supabase.rpc('fn_apply_stock_movement', {
      p_tenant_id: TEST_TENANT_ID,
      p_warehouse_id: warehouseId,
      p_location_id: null,
      p_item_id: itemId,
      p_variant_id: null,
      p_batch_id: null,
      p_movement_type: 'sale',
      p_direction: 'out',
      p_quantity: qty,
      p_unit_cost: unitCost,
      p_reference_type: 'test_sale',
      p_reference_id: null,
      p_created_by: null,
    });
    if (moveErr) throw moveErr;
  };

  beforeAll(async () => {
    supabase = createClient(process.env.SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string);
    const { data: wh, error } = await supabase.from('warehouses').select('id').eq('tenant_id', TEST_TENANT_ID).limit(1);
    if (error) throw error;
    warehouseId = wh![0].id;
  }, 30_000);

  afterAll(async () => {
    for (const itemId of itemIds) {
      await supabase.from('cost_layers').delete().eq('item_id', itemId);
      await supabase.from('stock_levels').delete().eq('item_id', itemId);
    }
    for (const id of grIds) {
      await supabase.from('goods_receipt_items').delete().eq('goods_receipt_id', id);
      await supabase.from('goods_receipts').delete().eq('id', id);
    }
    for (const itemId of itemIds) await supabase.from('items').delete().eq('id', itemId);
  }, 60_000);

  it('valuation report: matches exact weighted quantity/cost/total from two cost layers', async () => {
    const itemId = await createItem('AA71 Valuation Item');
    await seedStock(itemId, 10, 4); // 10 @ 4 = 40
    await seedStock(itemId, 20, 7); // 20 @ 7 = 140  -> total 30 units, 180 value, avg 6

    const { data, error } = await supabase.rpc('fn_inventory_valuation_report', {
      p_tenant_id: TEST_TENANT_ID,
      p_warehouse_id: warehouseId,
    });
    expect(error).toBeNull();
    const row = (data as any[]).find((r) => r.item_id === itemId);
    expect(row).toBeTruthy();
    expect(Number(row.quantity_on_hand)).toBe(30);
    expect(Number(row.total_value)).toBe(180);
    expect(Number(row.average_unit_cost)).toBe(6);
  }, 30_000);

  it('aging report: quantity lands in the correct bucket after backdating received_at', async () => {
    const itemId = await createItem('AA71 Aging Item');
    await seedStock(itemId, 15, 2); // fresh -> bucket_0_30
    await backdateCostLayer(itemId, 45); // -> bucket_31_60

    const { data, error } = await supabase.rpc('fn_inventory_aging_report', {
      p_tenant_id: TEST_TENANT_ID,
      p_warehouse_id: warehouseId,
    });
    expect(error).toBeNull();
    const row = (data as any[]).find((r) => r.item_id === itemId);
    expect(row).toBeTruthy();
    expect(Number(row.bucket_0_30)).toBe(0);
    expect(Number(row.bucket_31_60)).toBe(15);
    expect(Number(row.bucket_61_90)).toBe(0);
    expect(Number(row.bucket_90_plus)).toBe(0);
    expect(Number(row.total_quantity)).toBe(15);
    expect(Number(row.total_value)).toBe(30);
  }, 30_000);

  it('turnover report: cogs_in_period / current_value matches a known sale', async () => {
    const itemId = await createItem('AA71 Turnover Item');
    await seedStock(itemId, 100, 5); // 100 @ 5 = 500 current value before sale
    await recordSale(itemId, 20); // consumes 20 @ 5 = 100 COGS, leaves 80 @ 5 = 400 remaining value

    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase.rpc('fn_inventory_turnover_report', {
      p_tenant_id: TEST_TENANT_ID,
      p_warehouse_id: warehouseId,
      p_date_from: today,
      p_date_to: today,
    });
    expect(error).toBeNull();
    const row = (data as any[]).find((r) => r.item_id === itemId);
    expect(row).toBeTruthy();
    expect(Number(row.cogs_in_period)).toBe(100);
    expect(Number(row.average_inventory_value)).toBe(400);
    expect(Number(row.turnover_ratio)).toBe(0.25);
    expect(Number(row.days_in_period)).toBe(1);
  }, 30_000);
});
