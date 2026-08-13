/**
 * Regression suite for Migration 7.3 (Advanced Analytics Phase 3: Stock
 * Accuracy, Coverage). Runs directly against the real shared Supabase
 * project via the service-role client — same approach as every other
 * regression spec in this directory.
 *
 * Per the lesson learned in Migration 7.2 (the shared demo tenant
 * accumulates permanent stock_movements/stock_count history across every
 * regression spec in this session — never assume a hardcoded tenant-wide
 * total): Stock Accuracy is verified by independently recomputing the
 * expected aggregate from the exact same universe of rows the RPC reads
 * (ground-truth recomputation), not a hardcoded expected total. Coverage is
 * verified with per-item values, which fn_calculate_demand_forecast scopes
 * to a single item_id and is therefore unaffected by other items' activity.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const TEST_TENANT_ID = '9bcd3369-d664-47c8-b297-3bc9b429aacf'; // Sefay Demo

describe('advanced analytics phase 3 regression (Migration 7.3)', () => {
  let supabase: SupabaseClient;
  let warehouseId: string;
  const itemIds: string[] = [];
  const grIds: string[] = [];
  const stockCountIds: string[] = [];

  const createItem = async (name: string) => {
    const { data, error } = await supabase
      .from('items')
      .insert({
        tenant_id: TEST_TENANT_ID,
        name,
        type: 'product',
        operation_type: 'sell',
        price: 10,
        is_active: true,
      })
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
        receipt_number: `AA73-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        status: 'draft',
      })
      .select()
      .single();
    if (grErr) throw grErr;
    grIds.push(gr.id);

    const { error: lineErr } = await supabase
      .from('goods_receipt_items')
      .insert({
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
    const { data: unitCost, error: consumeErr } = await supabase.rpc(
      'fn_consume_cost_layers',
      {
        p_tenant_id: TEST_TENANT_ID,
        p_warehouse_id: warehouseId,
        p_item_id: itemId,
        p_variant_id: null,
        p_quantity: qty,
      },
    );
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

  // Directly creates an already-"completed" stock count with pre-computed
  // variance (counted_quantity - expected_quantity, matching the exact
  // convention fn_finalize_stock_count itself uses) — this migration is
  // testing the analytics read layer, not re-testing the finalize RPC
  // (already regression-tested elsewhere).
  const createCompletedStockCount = async (
    lines: { itemId: string; expected: number; counted: number }[],
  ) => {
    const { data: sc, error: scErr } = await supabase
      .from('stock_counts')
      .insert({
        tenant_id: TEST_TENANT_ID,
        warehouse_id: warehouseId,
        count_number: `AA73-SC-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        status: 'completed',
        completed_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (scErr) throw scErr;
    stockCountIds.push(sc.id);

    const { error: lineErr } = await supabase.from('stock_count_items').insert(
      lines.map((l) => ({
        tenant_id: TEST_TENANT_ID,
        stock_count_id: sc.id,
        item_id: l.itemId,
        expected_quantity: l.expected,
        counted_quantity: l.counted,
        variance: l.counted - l.expected,
      })),
    );
    if (lineErr) throw lineErr;
    return sc.id;
  };

  beforeAll(async () => {
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    );
    const { data: wh, error } = await supabase
      .from('warehouses')
      .select('id')
      .eq('tenant_id', TEST_TENANT_ID)
      .limit(1);
    if (error) throw error;
    warehouseId = wh[0].id;
  }, 30_000);

  afterAll(async () => {
    for (const id of stockCountIds) {
      await supabase
        .from('stock_count_items')
        .delete()
        .eq('stock_count_id', id);
      await supabase.from('stock_counts').delete().eq('id', id);
    }
    for (const itemId of itemIds) {
      await supabase.from('cost_layers').delete().eq('item_id', itemId);
      await supabase.from('stock_levels').delete().eq('item_id', itemId);
    }
    for (const id of grIds) {
      await supabase
        .from('goods_receipt_items')
        .delete()
        .eq('goods_receipt_id', id);
      await supabase.from('goods_receipts').delete().eq('id', id);
    }
    for (const itemId of itemIds) {
      const { error } = await supabase.from('items').delete().eq('id', itemId);
      if (error) {
        await supabase
          .from('items')
          .update({ is_active: false, deleted_at: new Date().toISOString() })
          .eq('id', itemId);
      }
    }
  }, 60_000);

  it('stock accuracy: RPC totals match an independent recomputation from the same completed-count universe', async () => {
    const itemExact = await createItem('AA73 Accuracy Item (exact)');
    const itemOff = await createItem('AA73 Accuracy Item (off by 10)');
    await createCompletedStockCount([
      { itemId: itemExact, expected: 100, counted: 100 }, // variance 0
      { itemId: itemOff, expected: 50, counted: 40 }, // variance -10
    ]);

    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase.rpc(
      'fn_inventory_stock_accuracy_report',
      {
        p_tenant_id: TEST_TENANT_ID,
        p_date_from: today,
        p_date_to: today,
        p_warehouse_id: warehouseId,
      },
    );
    expect(error).toBeNull();
    const row = (data as any[]).find((r) => r.warehouse_id === warehouseId);
    expect(row).toBeTruthy();

    // Ground truth: recompute independently from stock_count_items directly,
    // scoped to the exact same universe (completed counts, this warehouse,
    // today) the RPC itself reads — contamination-proof by construction,
    // regardless of any other completed counts that may exist for this
    // tenant/warehouse/date from other sessions or tests.
    const { data: rawItems, error: rawErr } = await supabase
      .from('stock_count_items')
      .select(
        'expected_quantity, variance, stock_counts!inner(warehouse_id, status, completed_at, tenant_id)',
      )
      .eq('stock_counts.tenant_id', TEST_TENANT_ID)
      .eq('stock_counts.warehouse_id', warehouseId)
      .eq('stock_counts.status', 'completed')
      .gte('stock_counts.completed_at', `${today}T00:00:00.000Z`)
      .lt('stock_counts.completed_at', `${today}T23:59:59.999Z`);
    expect(rawErr).toBeNull();

    const totalExpected = rawItems.reduce(
      (s, r: any) => s + Number(r.expected_quantity),
      0,
    );
    const totalAbsVariance = rawItems.reduce(
      (s, r: any) => s + Math.abs(Number(r.variance ?? 0)),
      0,
    );
    const expectedAccuracy =
      totalExpected > 0
        ? Math.round(
            ((totalExpected - totalAbsVariance) / totalExpected) * 10000,
          ) / 100
        : null;

    expect(Number(row.total_items_counted)).toBe(rawItems.length);
    expect(Number(row.total_expected_quantity)).toBe(totalExpected);
    expect(Number(row.total_absolute_variance_quantity)).toBe(totalAbsVariance);
    expect(Number(row.accuracy_percentage)).toBeCloseTo(expectedAccuracy, 1);

    // Our own two seeded lines are structurally correct regardless of what
    // else is in the universe: zero_variance_items includes at least our
    // exact-match line, and total_absolute_variance_quantity includes at
    // least our known 10-unit variance.
    expect(Number(row.zero_variance_items)).toBeGreaterThanOrEqual(1);
    expect(totalAbsVariance).toBeGreaterThanOrEqual(10);
  }, 30_000);

  it('coverage: exact days_of_coverage for a known quantity/demand pair; zero demand returns NULL', async () => {
    const activeItem = await createItem(
      'AA73 Coverage Item (50 on hand, sold 30 in 30d)',
    );
    const zeroItem = await createItem('AA73 Coverage Item (never sold)');
    await seedStock(activeItem, 80, 2); // 80 on hand before sale
    await seedStock(zeroItem, 20, 2);
    await recordSale(activeItem, 30); // consumes 30 -> 50 remaining on hand; 30 units sold in the 30-day lookback -> avg_daily_demand = 30/30 = 1

    const { data, error } = await supabase.rpc('fn_inventory_coverage_report', {
      p_tenant_id: TEST_TENANT_ID,
      p_warehouse_id: warehouseId,
    });
    expect(error).toBeNull();
    const activeRow = (data as any[]).find((r) => r.item_id === activeItem);
    const zeroRow = (data as any[]).find((r) => r.item_id === zeroItem);

    expect(Number(activeRow.quantity_on_hand)).toBe(50);
    expect(Number(activeRow.average_daily_demand)).toBe(1);
    expect(Number(activeRow.days_of_coverage)).toBe(50); // 50 / 1

    expect(Number(zeroRow.quantity_on_hand)).toBe(20);
    expect(Number(zeroRow.average_daily_demand)).toBe(0);
    expect(zeroRow.days_of_coverage).toBeNull(); // zero demand -> NULL, not 0 or Infinity
  }, 30_000);
});
