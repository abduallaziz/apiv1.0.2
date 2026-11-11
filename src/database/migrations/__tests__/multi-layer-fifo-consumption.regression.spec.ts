// Inventory Stage 1 / I3 (Owner-approved) — validates fn_consume_cost_layers'
// FIFO consumption actually crosses multiple cost layers correctly, computing
// a real weighted-average unit cost across the consumed portion of each layer
// — no existing regression spec exercised a sale spanning more than one
// layer. Uses the Master Plan's own worked example as the fixture:
//   100 units @ 7 SAR
//   100 units @ 8 SAR
//   sale of 120 units, FIFO
//   => COGS = 100*7 + 20*8 = 860 SAR, weighted unit cost = 860/120 = 7.1667
import 'dotenv/config';
import { pickTestWarehouse } from '../../../../test/support/test-tenant';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

describe('multi-layer FIFO consumption (Master Plan I3 fixture)', () => {
  let supabase: SupabaseClient;
  let tenantId: string;
  let warehouseId: string;
  let itemId: string;
  const layerIds: string[] = [];

  beforeAll(async () => {
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    );

    const warehouse = await pickTestWarehouse(supabase);
    warehouseId = warehouse.id;
    tenantId = warehouse.tenant_id;

    const { data: item, error } = await supabase
      .from('items')
      .insert({
        tenant_id: tenantId,
        name: 'QA I3 Multi-Layer FIFO Test Item',
        type: 'product',
        operation_type: 'sell',
        price: 20,
        has_inventory: true,
        costing_method: 'fifo',
      })
      .select('id')
      .single();
    if (error) throw error;
    itemId = item.id;
  });

  afterAll(async () => {
    await supabase.from('cost_layers').delete().eq('item_id', itemId);
    await supabase.from('stock_levels').delete().eq('item_id', itemId);
    await supabase.from('items').delete().eq('id', itemId);
  });

  it('Test 1: seeds two discrete FIFO layers (100@7, 100@8) via fn_add_cost_layer', async () => {
    const first = await supabase.rpc('fn_add_cost_layer', {
      p_tenant_id: tenantId,
      p_warehouse_id: warehouseId,
      p_item_id: itemId,
      p_variant_id: null,
      p_batch_id: null,
      p_quantity: 100,
      p_unit_cost: 7,
      p_source_movement_id: null,
    });
    expect(first.error).toBeNull();

    const second = await supabase.rpc('fn_add_cost_layer', {
      p_tenant_id: tenantId,
      p_warehouse_id: warehouseId,
      p_item_id: itemId,
      p_variant_id: null,
      p_batch_id: null,
      p_quantity: 100,
      p_unit_cost: 8,
      p_source_movement_id: null,
    });
    expect(second.error).toBeNull();

    const { data: layers } = await supabase
      .from('cost_layers')
      .select('id, unit_cost, quantity_received, quantity_remaining')
      .eq('item_id', itemId)
      .order('received_at', { ascending: true });

    expect(layers).toHaveLength(2);
    expect(layers[0].unit_cost).toBe(7);
    expect(layers[0].quantity_remaining).toBe(100);
    expect(layers[1].unit_cost).toBe(8);
    expect(layers[1].quantity_remaining).toBe(100);
    layerIds.push(...layers.map((l) => l.id as string));
  });

  it('Test 2: consuming 120 units crosses both layers and returns the correct weighted-average cost (860/120)', async () => {
    const { data: unitCost, error } = await supabase.rpc(
      'fn_consume_cost_layers',
      {
        p_tenant_id: tenantId,
        p_warehouse_id: warehouseId,
        p_item_id: itemId,
        p_variant_id: null,
        p_quantity: 120,
      },
    );

    expect(error).toBeNull();
    // 100*7 + 20*8 = 860; 860/120 = 7.1667 (rounded to 4dp per fn_consume_cost_layers)
    expect(Number(unitCost)).toBeCloseTo(860 / 120, 4);
  });

  it('Test 3: first layer (7 SAR) is fully exhausted, second layer (8 SAR) has exactly 80 remaining', async () => {
    const { data: layers } = await supabase
      .from('cost_layers')
      .select('unit_cost, quantity_remaining')
      .eq('item_id', itemId)
      .order('received_at', { ascending: true });

    expect(layers[0].quantity_remaining).toBe(0); // fully consumed layer @7
    expect(layers[1].quantity_remaining).toBe(80); // 100 - 20 consumed @8
  });

  it('Test 4: consuming beyond remaining layers without allow_partial raises INSUFFICIENT_COST_LAYERS', async () => {
    const { error } = await supabase.rpc('fn_consume_cost_layers', {
      p_tenant_id: tenantId,
      p_warehouse_id: warehouseId,
      p_item_id: itemId,
      p_variant_id: null,
      p_quantity: 1000,
    });

    expect(error).not.toBeNull();
    expect(error.message).toMatch(/INSUFFICIENT_COST_LAYERS/);
  });

  it('Test 5: consuming beyond remaining layers WITH allow_partial succeeds and consumes only what exists (COGS from real remaining cost, not guessed)', async () => {
    const { data: unitCost, error } = await supabase.rpc(
      'fn_consume_cost_layers',
      {
        p_tenant_id: tenantId,
        p_warehouse_id: warehouseId,
        p_item_id: itemId,
        p_variant_id: null,
        p_quantity: 1000,
        p_allow_partial: true,
      },
    );

    expect(error).toBeNull();
    // Only the remaining 80 units @8 exist — weighted cost over the
    // consumed portion collapses to exactly 8, not an average diluted by
    // the requested-but-nonexistent 920 units.
    expect(Number(unitCost)).toBe(8);

    const { data: layers } = await supabase
      .from('cost_layers')
      .select('quantity_remaining')
      .eq('item_id', itemId)
      .order('received_at', { ascending: true });
    expect(layers[0].quantity_remaining).toBe(0);
    expect(layers[1].quantity_remaining).toBe(0); // fully exhausted, not negative
  });

  it('Test 6: restoration — fn_add_cost_layer re-adds quantity/cost after a return (as used by fn_reverse_sale_stock_deduction)', async () => {
    const { error } = await supabase.rpc('fn_add_cost_layer', {
      p_tenant_id: tenantId,
      p_warehouse_id: warehouseId,
      p_item_id: itemId,
      p_variant_id: null,
      p_batch_id: null,
      p_quantity: 20,
      p_unit_cost: 8,
      p_source_movement_id: null,
    });
    expect(error).toBeNull();

    const { data: layers } = await supabase
      .from('cost_layers')
      .select('quantity_remaining')
      .eq('item_id', itemId)
      .gt('quantity_remaining', 0);
    expect(
      layers.reduce((sum, l) => sum + Number(l.quantity_remaining), 0),
    ).toBe(20);
  });
});
