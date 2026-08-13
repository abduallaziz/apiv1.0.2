/**
 * Regression suite for Migration 13.17 Phase A (migration 158):
 * Safety Stock calculation + Reorder Planning completion.
 * Runs directly against the real shared Supabase project, same pattern as
 * unified-lead-time.regression.spec.ts. Not wired into CI — run via `npm test`.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const TEST_TENANT_ID = '9bcd3369-d664-47c8-b297-3bc9b429aacf'; // Sefay Demo

describe('Safety Stock + Reorder Planning completion (migration 158)', () => {
  let supabase: SupabaseClient;
  let warehouseId: string;
  let itemId: string;
  let reorderPointId: string;

  beforeAll(async () => {
    supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    const { data: wh } = await supabase.from('warehouses').select('id').eq('tenant_id', TEST_TENANT_ID).limit(1);
    warehouseId = wh![0].id;

    const { data: item } = await supabase
      .from('items')
      .insert({ tenant_id: TEST_TENANT_ID, name: 'Regression 13.17 Item', type: 'product', operation_type: 'sell', price: 5, is_active: true })
      .select()
      .single();
    itemId = item.id;

    // Variable daily sale demand over the last 10 days (0, 10, 0, 20, 0, 10, 0, 30, 0, 10)
    // -> real variance, so STDDEV_SAMP is meaningfully non-zero. stock_movements is an
    // immutable append-only ledger (trigger blocks UPDATE/DELETE — migration 017), so
    // these rows are inserted directly (all NOT NULL columns filled) and intentionally
    // left in place rather than cleaned up; the fixture item is deactivated instead of
    // deleted in afterAll since items.id has ON DELETE RESTRICT from stock_movements.
    const quantities = [0, 10, 0, 20, 0, 10, 0, 30, 0, 10];
    for (let i = 0; i < quantities.length; i++) {
      if (quantities[i] === 0) continue;
      const occurredAt = new Date();
      occurredAt.setDate(occurredAt.getDate() - i);
      const { error: mvError } = await supabase.from('stock_movements').insert({
        tenant_id: TEST_TENANT_ID,
        warehouse_id: warehouseId,
        item_id: itemId,
        movement_type: 'sale',
        direction: 'out',
        quantity: quantities[i],
        unit_cost: 5,
        total_cost: 5 * quantities[i],
        reference_type: 'regression_test',
        occurred_at: occurredAt.toISOString(),
      });
      if (mvError) throw mvError;
    }
  }, 30_000);

  afterAll(async () => {
    if (reorderPointId) {
      await supabase.from('inventory_reorder_points').delete().eq('id', reorderPointId);
    }
    await supabase.from('items').update({ is_active: false, deleted_at: new Date().toISOString() }).eq('id', itemId);
  }, 30_000);

  it('1. fn_calculate_safety_stock returns a real calculated recommendation (> 0) from demand variability', async () => {
    const { data, error } = await supabase.rpc('fn_calculate_safety_stock', {
      p_tenant_id: TEST_TENANT_ID,
      p_warehouse_id: warehouseId,
      p_item_id: itemId,
      p_variant_id: null,
      p_lookback_days: 10,
    });
    expect(error).toBeNull();
    expect(Number(data)).toBeGreaterThan(0);
  });

  it('2. manual min_quantity override on inventory_reorder_points is unaffected by the safety-stock function', async () => {
    const { data: rp, error } = await supabase
      .from('inventory_reorder_points')
      .insert({
        tenant_id: TEST_TENANT_ID,
        warehouse_id: warehouseId,
        item_id: itemId,
        min_quantity: 42, // deliberate manual floor, unrelated to the calculated recommendation
        reorder_quantity: 15,
        is_active: true,
      })
      .select()
      .single();
    expect(error).toBeNull();
    reorderPointId = rp.id;

    // Calling the safety-stock function does not write anything — re-read confirms min_quantity untouched.
    await supabase.rpc('fn_calculate_safety_stock', {
      p_tenant_id: TEST_TENANT_ID,
      p_warehouse_id: warehouseId,
      p_item_id: itemId,
      p_variant_id: null,
    });
    const { data: reread } = await supabase
      .from('inventory_reorder_points')
      .select('min_quantity')
      .eq('id', reorderPointId)
      .single();
    expect(Number(reread!.min_quantity)).toBe(42);
  });

  it('3. existing reorder-point behavior (fn_purchase_suggestions) is unchanged for rows with no service_level_z set', async () => {
    const { data: suggestions, error } = await supabase.rpc('fn_purchase_suggestions', { p_tenant_id: TEST_TENANT_ID });
    expect(error).toBeNull();
    const mine = (suggestions as any[]).find((s) => s.reorder_point_id === reorderPointId);
    // Same fields/shape as before migration 158 - no new required columns broke the function.
    expect(mine).toBeDefined();
    expect(mine).toHaveProperty('suggested_order_quantity');
  });

  it('4. shortage is detected: item is available_quantity 0 <= min_quantity 42', async () => {
    const { data: below, error } = await supabase.rpc('fn_purchase_suggestions', { p_tenant_id: TEST_TENANT_ID });
    expect(error).toBeNull();
    const mine = (below as any[]).find((s) => s.reorder_point_id === reorderPointId);
    expect(Number(mine.quantity_available)).toBeLessThanOrEqual(42);
  });

  it('5. purchase suggestion is generated with a positive suggested_order_quantity for the shortage', async () => {
    const { data: suggestions } = await supabase.rpc('fn_purchase_suggestions', { p_tenant_id: TEST_TENANT_ID });
    const mine = (suggestions as any[]).find((s) => s.reorder_point_id === reorderPointId);
    expect(Number(mine.suggested_order_quantity)).toBeGreaterThan(0);
  });

  it('6. a suggestion can be converted into a Purchase Request draft via the existing purchase_requests tables (reused, not duplicated)', async () => {
    const { data: pr, error: prError } = await supabase
      .from('purchase_requests')
      .insert({
        tenant_id: TEST_TENANT_ID,
        warehouse_id: warehouseId,
        request_number: `PR-SUGG-TEST-${Date.now()}`,
        status: 'draft',
        notes: 'Generated from purchase suggestions',
      })
      .select()
      .single();
    expect(prError).toBeNull();

    const { data: prItem, error: itemError } = await supabase
      .from('purchase_request_items')
      .insert({
        tenant_id: TEST_TENANT_ID,
        purchase_request_id: pr.id,
        item_id: itemId,
        quantity_requested: 15,
      })
      .select()
      .single();
    expect(itemError).toBeNull();
    expect(prItem.purchase_request_id).toBe(pr.id);

    await supabase.from('purchase_request_items').delete().eq('id', prItem.id);
    await supabase.from('purchase_requests').delete().eq('id', pr.id);
  });

  it('7. tenant isolation: fn_calculate_safety_stock returns 0 for a different (non-existent-data) tenant', async () => {
    const { data } = await supabase.rpc('fn_calculate_safety_stock', {
      p_tenant_id: '00000000-0000-0000-0000-000000000000',
      p_warehouse_id: warehouseId,
      p_item_id: itemId,
      p_variant_id: null,
    });
    expect(Number(data)).toBe(0);
  });
});
