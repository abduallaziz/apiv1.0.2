/**
 * Regression suite for Migration 7.2 (Advanced Analytics Phase 2: ABC,
 * Dead Stock, Slow Moving, Overstock). Runs directly against the real
 * shared Supabase project via the service-role client — same approach as
 * every other regression spec in this directory.
 *
 * Note: stock_movements is immutable (UPDATE/DELETE blocked by trigger), so
 * "recent vs old outbound movement" for Dead Stock is proven via a movement
 * recorded right now (always more recent than any positive lookback window)
 * rather than by backdating a movement row — a real movement dated "now" is
 * sufficient to prove the exclusion boundary without needing to violate the
 * ledger's immutability for test setup.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const TEST_TENANT_ID = '9bcd3369-d664-47c8-b297-3bc9b429aacf'; // Sefay Demo

describe('advanced analytics phase 2 regression (Migration 7.2)', () => {
  let supabase: SupabaseClient;
  let warehouseId: string;
  const itemIds: string[] = [];
  const grIds: string[] = [];
  const reorderPointIds: string[] = [];

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
        receipt_number: `AA72-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
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

  const createReorderPoint = async (itemId: string, maxQuantity: number) => {
    const { data, error } = await supabase
      .from('inventory_reorder_points')
      .insert({
        tenant_id: TEST_TENANT_ID,
        warehouse_id: warehouseId,
        item_id: itemId,
        min_quantity: 5,
        max_quantity: maxQuantity,
        reorder_quantity: 10,
        is_active: true,
      })
      .select()
      .single();
    if (error) throw error;
    reorderPointIds.push(data.id);
  };

  beforeAll(async () => {
    supabase = createClient(process.env.SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string);
    const { data: wh, error } = await supabase.from('warehouses').select('id').eq('tenant_id', TEST_TENANT_ID).limit(1);
    if (error) throw error;
    warehouseId = wh![0].id;
  }, 30_000);

  afterAll(async () => {
    for (const id of reorderPointIds) await supabase.from('inventory_reorder_points').delete().eq('id', id);
    for (const itemId of itemIds) {
      await supabase.from('cost_layers').delete().eq('item_id', itemId);
      await supabase.from('stock_levels').delete().eq('item_id', itemId);
    }
    for (const id of grIds) {
      await supabase.from('goods_receipt_items').delete().eq('goods_receipt_id', id);
      await supabase.from('goods_receipts').delete().eq('id', id);
    }
    // items.id has stock_movements.item_id ON DELETE RESTRICT — any item
    // that had a recordSale() cannot be hard-deleted (its ledger rows are
    // immutable and permanent by design). Deactivate instead of a blind,
    // unchecked delete, so leftover test items are at least clearly marked
    // inactive rather than silently failing to delete every run.
    for (const itemId of itemIds) {
      const { error } = await supabase.from('items').delete().eq('id', itemId);
      if (error) {
        await supabase.from('items').update({ is_active: false, deleted_at: new Date().toISOString() }).eq('id', itemId);
      }
    }
  }, 60_000);

  // This tenant is shared across every regression spec in this session, and
  // stock_movements is intentionally never cleaned up (immutable ledger —
  // "sale" rows from every prior test run permanently remain). That makes
  // tenant-wide cumulative-% assertions non-reproducible run over run. Two
  // things ARE reproducible regardless of unrelated same-day activity:
  // (1) cogs_in_period is computed per-item, so our 3 seeded items' own
  //     values are exact no matter what else sold today;
  // (2) the classification formula's internal consistency — for EVERY row
  //     the RPC returns (not just ours), classification must match the
  //     documented threshold given that row's own cumulative_percentage.
  // Both are verified below instead of a hardcoded expected total.
  it('ABC analysis: per-item COGS is exact, and classification is internally consistent with cumulative_percentage for every row', async () => {
    const itemA = await createItem('AA72 ABC Item A (80k)');
    const itemB = await createItem('AA72 ABC Item B (15k)');
    const itemC = await createItem('AA72 ABC Item C (5k)');
    await seedStock(itemA, 80000, 1);
    await seedStock(itemB, 15000, 1);
    await seedStock(itemC, 5000, 1);
    await recordSale(itemA, 80000); // COGS 80,000 (exact, per-item, unaffected by other tenant activity)
    await recordSale(itemB, 15000); // COGS 15,000
    await recordSale(itemC, 5000); // COGS 5,000

    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase.rpc('fn_inventory_abc_analysis', {
      p_tenant_id: TEST_TENANT_ID,
      p_date_from: today,
      p_date_to: today,
      p_warehouse_id: warehouseId,
    });
    expect(error).toBeNull();
    const rows = data as any[];
    const rowA = rows.find((r) => r.item_id === itemA);
    const rowB = rows.find((r) => r.item_id === itemB);
    const rowC = rows.find((r) => r.item_id === itemC);

    expect(Number(rowA.cogs_in_period)).toBe(80000);
    expect(Number(rowB.cogs_in_period)).toBe(15000);
    expect(Number(rowC.cogs_in_period)).toBe(5000);
    // Deliberately NOT asserting exact rank position (e.g. "itemA is
    // rows[0]") — this tenant's stock_movements ledger is immutable and
    // shared across every regression spec in this session, so it can
    // accumulate other same-day sale rows (including ties) that this test
    // cannot control or predict. Per-item COGS and the classification
    // formula's self-consistency (below) are what's actually being proven.

    for (const row of rows) {
      const cum = Number(row.cumulative_percentage);
      const expectedClass = cum <= 80 ? 'A' : cum <= 95 ? 'B' : 'C';
      expect(row.classification).toBe(expectedClass);
    }
  }, 30_000);

  it('dead stock: item with zero outbound movement appears; item with a recent sale does not', async () => {
    const deadItem = await createItem('AA72 Dead Stock Item (never sold)');
    const activeItem = await createItem('AA72 Dead Stock Item (sold today)');
    await seedStock(deadItem, 20, 3);
    await seedStock(activeItem, 20, 3);
    await recordSale(activeItem, 5); // sold just now -> not dead

    const { data, error } = await supabase.rpc('fn_inventory_dead_stock_report', {
      p_tenant_id: TEST_TENANT_ID,
      p_lookback_days: 90,
      p_warehouse_id: warehouseId,
    });
    expect(error).toBeNull();
    const ids = (data as any[]).map((r) => r.item_id);
    expect(ids).toContain(deadItem);
    expect(ids).not.toContain(activeItem);
    const deadRow = (data as any[]).find((r) => r.item_id === deadItem);
    expect(deadRow.last_outbound_at).toBeNull();
  }, 30_000);

  it('slow moving: low-sales item appears; zero-sales and high-sales items are excluded', async () => {
    const lowItem = await createItem('AA72 Slow Moving (3 sold)');
    const zeroItem = await createItem('AA72 Slow Moving (0 sold)');
    const highItem = await createItem('AA72 Slow Moving (50 sold)');
    await seedStock(lowItem, 100, 2);
    await seedStock(zeroItem, 100, 2);
    await seedStock(highItem, 100, 2);
    await recordSale(lowItem, 3);
    await recordSale(highItem, 50);

    const { data, error } = await supabase.rpc('fn_inventory_slow_moving_report', {
      p_tenant_id: TEST_TENANT_ID,
      p_lookback_days: 90,
      p_max_units_sold: 5,
      p_warehouse_id: warehouseId,
    });
    expect(error).toBeNull();
    const ids = (data as any[]).map((r) => r.item_id);
    expect(ids).toContain(lowItem);
    expect(ids).not.toContain(zeroItem); // 0 sold -> Dead Stock's bucket, not Slow Moving
    expect(ids).not.toContain(highItem); // exceeds max_units_sold
  }, 30_000);

  it('overstock: item above max_quantity returns correct excess; item without reorder point returns has_reorder_point=false', async () => {
    const overstockedItem = await createItem('AA72 Overstock Item (80 on hand, max 50)');
    const unconfiguredItem = await createItem('AA72 Overstock Item (no reorder point)');
    await seedStock(overstockedItem, 80, 4);
    await seedStock(unconfiguredItem, 30, 4);
    await createReorderPoint(overstockedItem, 50);

    const { data, error } = await supabase.rpc('fn_inventory_overstock_report', {
      p_tenant_id: TEST_TENANT_ID,
      p_warehouse_id: warehouseId,
    });
    expect(error).toBeNull();
    const overRow = (data as any[]).find((r) => r.item_id === overstockedItem);
    const unconfRow = (data as any[]).find((r) => r.item_id === unconfiguredItem);

    expect(overRow.has_reorder_point).toBe(true);
    expect(Number(overRow.excess_quantity)).toBe(30); // 80 - 50
    expect(Number(overRow.excess_value)).toBe(120); // 30 * 4

    expect(unconfRow.has_reorder_point).toBe(false);
    expect(unconfRow.excess_quantity).toBeNull();
    expect(unconfRow.excess_value).toBeNull();
  }, 30_000);
});
