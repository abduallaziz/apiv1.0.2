/**
 * Regression suite for migration 140 (manufacturing location integration).
 * Runs directly against the real shared Supabase project via the
 * service-role client — same approach as transfer-lifecycle.regression.spec.ts,
 * there is no isolated test database in this environment. Every fixture is
 * tenant-scoped and torn down in afterAll; not wired into CI — run
 * deliberately via `npm test` when touching this area again.
 *
 * Exists to prove: (1) fn_post_production_order with no locations set behaves
 * identically to the pre-140 version (bit-for-bit same stock_levels/
 * cost_layers outcome), and (2) with source_location_id/output_location_id
 * set, consumption and receipt land at the specific location rather than the
 * warehouse-level (location IS NULL) bucket, with cost layers/valuation
 * unaffected either way.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const TEST_TENANT_ID = '9bcd3369-d664-47c8-b297-3bc9b429aacf'; // Sefay Demo

describe('manufacturing location integration regression (migration 140)', () => {
  let supabase: SupabaseClient;
  let warehouseId: string;
  const cleanup: { table: string; id: string }[] = [];
  const itemIds: string[] = [];
  const locationIds: string[] = [];
  const bomIds: string[] = [];
  const orderIds: string[] = [];

  const createItem = async (name: string) => {
    const { data, error } = await supabase
      .from('items')
      .insert({
        tenant_id: TEST_TENANT_ID,
        name,
        type: 'product',
        operation_type: 'sell',
        price: 5,
        is_active: true,
      })
      .select()
      .single();
    if (error) throw error;
    itemIds.push(data.id);
    return data.id;
  };

  const createLocation = async (code: string) => {
    const { data, error } = await supabase
      .from('warehouse_locations')
      .insert({
        tenant_id: TEST_TENANT_ID,
        warehouse_id: warehouseId,
        code,
        name: code,
        location_type: 'zone',
      })
      .select()
      .single();
    if (error) throw error;
    locationIds.push(data.id);
    return data.id;
  };

  // Seeds componentQty units of componentItemId at the given location (or
  // warehouse-level if null) via a real Goods Receipt, so cost_layers are
  // populated through the normal path rather than inserted directly.
  const seedStock = async (
    componentItemId: string,
    qty: number,
    unitCost: number,
    locationId: string | null = null,
  ) => {
    const { data: gr, error: grErr } = await supabase
      .from('goods_receipts')
      .insert({
        tenant_id: TEST_TENANT_ID,
        warehouse_id: warehouseId,
        receipt_number: `MFGREGR-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        status: 'draft',
      })
      .select()
      .single();
    if (grErr) throw grErr;
    cleanup.push({ table: 'goods_receipts', id: gr.id });

    const { error: lineErr } = await supabase
      .from('goods_receipt_items')
      .insert({
        tenant_id: TEST_TENANT_ID,
        goods_receipt_id: gr.id,
        item_id: componentItemId,
        quantity_received: qty,
        unit_cost: unitCost,
        location_id: locationId,
      });
    if (lineErr) throw lineErr;

    const { error: postErr } = await supabase.rpc('fn_post_goods_receipt', {
      p_goods_receipt_id: gr.id,
      p_actor_id: null,
    });
    if (postErr) throw postErr;
  };

  const createBom = async (
    finishedItemId: string,
    componentItemId: string,
    qtyPerUnit: number,
  ) => {
    const { data: bom, error: bomErr } = await supabase
      .from('bill_of_materials')
      .insert({
        tenant_id: TEST_TENANT_ID,
        item_id: finishedItemId,
        is_active: true,
      })
      .select()
      .single();
    if (bomErr) throw bomErr;
    bomIds.push(bom.id);

    const { error: lineErr } = await supabase.from('bom_lines').insert({
      tenant_id: TEST_TENANT_ID,
      bom_id: bom.id,
      component_item_id: componentItemId,
      quantity_per_unit: qtyPerUnit,
      scrap_percentage: 0,
    });
    if (lineErr) throw lineErr;

    return bom.id;
  };

  const createOrder = async (
    bomId: string,
    quantityPlanned: number,
    locations: {
      source_location_id?: string | null;
      staging_location_id?: string | null;
      output_location_id?: string | null;
    } = {},
  ) => {
    const { data, error } = await supabase
      .from('production_orders')
      .insert({
        tenant_id: TEST_TENANT_ID,
        warehouse_id: warehouseId,
        bom_id: bomId,
        order_number: `MFGREGR-PO-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        quantity_planned: quantityPlanned,
        status: 'draft',
        ...locations,
      })
      .select()
      .single();
    if (error) throw error;
    orderIds.push(data.id);
    return data.id;
  };

  const balanceAt = async (itemId: string, locationId: string | null) => {
    let q = supabase
      .from('stock_levels')
      .select('quantity_on_hand')
      .eq('item_id', itemId);
    q =
      locationId === null
        ? q.is('location_id', null)
        : q.eq('location_id', locationId);
    const { data } = await q.maybeSingle();
    return data ? Number(data.quantity_on_hand) : 0;
  };

  const totalValuation = async (itemId: string) => {
    const { data } = await supabase
      .from('cost_layers')
      .select('quantity_remaining, unit_cost')
      .eq('item_id', itemId);
    return (data ?? []).reduce(
      (s, r) => s + Number(r.quantity_remaining) * Number(r.unit_cost),
      0,
    );
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
    for (const id of orderIds) {
      await supabase.from('production_orders').delete().eq('id', id);
    }
    for (const id of bomIds) {
      await supabase.from('bom_lines').delete().eq('bom_id', id);
      await supabase.from('bill_of_materials').delete().eq('id', id);
    }
    for (const itemId of itemIds) {
      await supabase.from('cost_layers').delete().eq('item_id', itemId);
      await supabase.from('stock_levels').delete().eq('item_id', itemId);
    }
    for (const c of cleanup) {
      await supabase
        .from('goods_receipt_items')
        .delete()
        .eq('goods_receipt_id', c.id);
      await supabase.from(c.table).delete().eq('id', c.id);
    }
    for (const itemId of itemIds) {
      await supabase.from('items').delete().eq('id', itemId);
    }
    for (const id of locationIds) {
      await supabase.from('warehouse_locations').delete().eq('id', id);
    }
    // stock_movements rows intentionally left — ledger is immutable by trigger.
  }, 30_000);

  it('regression: no locations set behaves exactly as before migration 140 (warehouse-level, location IS NULL bucket)', async () => {
    const componentId = await createItem('MFG Regr Component (no loc)');
    const finishedId = await createItem('MFG Regr Finished (no loc)');
    await seedStock(componentId, 100, 4, null);

    const bomId = await createBom(finishedId, componentId, 2);
    const orderId = await createOrder(bomId, 10); // no location fields set -> all NULL

    const { data: posted, error } = await supabase.rpc(
      'fn_post_production_order',
      {
        p_production_order_id: orderId,
        p_actor_id: null,
      },
    );
    expect(error).toBeNull();
    expect(posted.status).toBe('completed');
    expect(Number(posted.quantity_produced)).toBe(10);

    // Consumption: 10 * 2 = 20 units consumed from the warehouse-level (NULL) bucket.
    expect(await balanceAt(componentId, null)).toBe(80);
    // Receipt: 10 units of finished good land in the warehouse-level (NULL) bucket.
    expect(await balanceAt(finishedId, null)).toBe(10);
    // Cost layer for finished good: total component cost 20*4=80, /10 = unit cost 8.
    expect(await totalValuation(finishedId)).toBe(80);
  }, 30_000);

  it('production consumption with source_location_id draws from that specific location, not warehouse-level', async () => {
    const componentId = await createItem('MFG Regr Component (src loc)');
    const finishedId = await createItem('MFG Regr Finished (src loc)');
    const sourceLoc = await createLocation(`MFG-SRC-${Date.now()}`);
    await seedStock(componentId, 50, 3, sourceLoc);

    const bomId = await createBom(finishedId, componentId, 5);
    const orderId = await createOrder(bomId, 4, {
      source_location_id: sourceLoc,
    });

    const { data: posted, error } = await supabase.rpc(
      'fn_post_production_order',
      {
        p_production_order_id: orderId,
        p_actor_id: null,
      },
    );
    expect(error).toBeNull();
    expect(posted.status).toBe('completed');

    // 4 * 5 = 20 units consumed specifically from sourceLoc, not the NULL bucket.
    expect(await balanceAt(componentId, sourceLoc)).toBe(30);
    expect(await balanceAt(componentId, null)).toBe(0);
  }, 30_000);

  it('finished goods receipt with output_location_id lands at that location, available to WMS-style location queries', async () => {
    const componentId = await createItem('MFG Regr Component (out loc)');
    const finishedId = await createItem('MFG Regr Finished (out loc)');
    const outputLoc = await createLocation(`MFG-OUT-${Date.now()}`);
    await seedStock(componentId, 60, 2, null);

    const bomId = await createBom(finishedId, componentId, 3);
    const orderId = await createOrder(bomId, 5, {
      output_location_id: outputLoc,
    });

    const { data: posted, error } = await supabase.rpc(
      'fn_post_production_order',
      {
        p_production_order_id: orderId,
        p_actor_id: null,
      },
    );
    expect(error).toBeNull();
    expect(posted.status).toBe('completed');

    // Finished good lands at outputLoc, not the warehouse-level (NULL) bucket.
    expect(await balanceAt(finishedId, outputLoc)).toBe(5);
    expect(await balanceAt(finishedId, null)).toBe(0);
    // Cost layer unaffected by location: 15 units * 2 = 30 total cost / 5 = unit cost 6.
    expect(await totalValuation(finishedId)).toBe(30);
  }, 30_000);

  it('cost layers/valuation remain identical whether or not locations are used (costing stays warehouse-scoped)', async () => {
    const componentA = await createItem('MFG Regr Cost Component A');
    const finishedA = await createItem('MFG Regr Cost Finished A');
    await seedStock(componentA, 40, 10, null);
    const bomA = await createBom(finishedA, componentA, 4);
    const orderA = await createOrder(bomA, 5); // no locations

    const componentB = await createItem('MFG Regr Cost Component B');
    const finishedB = await createItem('MFG Regr Cost Finished B');
    const srcB = await createLocation(`MFG-COST-SRC-${Date.now()}`);
    const outB = await createLocation(`MFG-COST-OUT-${Date.now()}`);
    await seedStock(componentB, 40, 10, srcB);
    const bomB = await createBom(finishedB, componentB, 4);
    const orderB = await createOrder(bomB, 5, {
      source_location_id: srcB,
      output_location_id: outB,
    });

    const [resA, resB] = await Promise.all([
      supabase.rpc('fn_post_production_order', {
        p_production_order_id: orderA,
        p_actor_id: null,
      }),
      supabase.rpc('fn_post_production_order', {
        p_production_order_id: orderB,
        p_actor_id: null,
      }),
    ]);
    expect(resA.error).toBeNull();
    expect(resB.error).toBeNull();

    // Same BOM ratio/cost inputs -> identical unit cost and total valuation,
    // regardless of whether locations were specified.
    const valuationA = await totalValuation(finishedA);
    const valuationB = await totalValuation(finishedB);
    expect(valuationA).toBe(valuationB);
    expect(valuationA).toBe(200); // 4*5=20 units consumed * unit cost 10 = 200 total component cost = total finished-good valuation
  }, 30_000);
});
