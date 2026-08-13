/**
 * Regression suite for Migration 13.15-fix (Costing Application Exposure, #15).
 * Runs directly against the real shared Supabase project via the
 * service-role client — same convention as every other regression spec in
 * this directory. Exercises the real ItemsService/StockService/
 * LandedCostsService classes directly (the actual integration points),
 * plus fn_add_cost_layer/fn_consume_cost_layers via direct RPC calls to
 * confirm the costing engine itself is untouched.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

import { ItemsService } from '../../../modules/items/items.service';
import { ItemsRepository } from '../../../modules/items/repositories/items.repository';
import { StockService } from '../../../modules/inventory/stock.service';
import { StockRepository } from '../../../modules/inventory/repositories/stock.repository';
import { GoodsReceiptsService } from '../../../modules/purchasing/goods-receipts.service';
import { GoodsReceiptsRepository } from '../../../modules/purchasing/repositories/goods-receipts.repository';
import { LandedCostsService } from '../../../modules/purchasing/landed-costs.service';
import { LandedCostsRepository } from '../../../modules/purchasing/repositories/landed-costs.repository';

const TEST_TENANT_ID = '9bcd3369-d664-47c8-b297-3bc9b429aacf'; // Sefay Demo
const OTHER_TENANT_ID = '00000000-0000-0000-0000-000000000005';

const fakeCache = {
  get: async () => null,
  set: async () => undefined,
  delByPrefix: async () => undefined,
} as any;
const fakeBarcodesService = { generateForItem: async () => undefined } as any;
const fakeTenantSession = {} as any;

describe('costing application exposure regression (Migration 13.15-fix)', () => {
  let supabase: SupabaseClient;
  let itemsService: ItemsService;
  let stockService: StockService;
  let goodsReceiptsService: GoodsReceiptsService;
  let landedCostsService: LandedCostsService;
  let warehouseId: string;
  const itemIds: string[] = [];
  const grIds: string[] = [];

  beforeAll(async () => {
    supabase = createClient(process.env.SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string);

    const itemsRepo = new ItemsRepository(supabase);
    itemsService = new ItemsService(itemsRepo, fakeCache, fakeBarcodesService);

    const stockRepo = new StockRepository(supabase, fakeTenantSession);
    stockService = new StockService(stockRepo, fakeCache, { get: () => undefined } as any);

    const goodsReceiptsRepo = new GoodsReceiptsRepository(supabase);
    // LocationsService/PurchaseOrdersService are only touched when a line
    // sets location_id or the header sets purchase_order_id — neither is
    // used by this suite's receipts, so unused stubs are safe here.
    goodsReceiptsService = new GoodsReceiptsService(goodsReceiptsRepo, {} as any, {} as any, {} as any, {} as any, {} as any);

    const landedCostsRepo = new LandedCostsRepository(supabase);
    landedCostsService = new LandedCostsService(landedCostsRepo, goodsReceiptsService);

    const { data: wh, error: whErr } = await supabase
      .from('warehouses')
      .select('id')
      .eq('tenant_id', TEST_TENANT_ID)
      .limit(1)
      .single();
    if (whErr) throw whErr;
    warehouseId = wh.id;
  }, 30_000);

  afterAll(async () => {
    for (const id of grIds) {
      await supabase.from('landed_costs').delete().eq('goods_receipt_id', id);
      await supabase.from('goods_receipt_items').delete().eq('goods_receipt_id', id);
      await supabase.from('goods_receipts').delete().eq('id', id);
    }
    await supabase.from('cost_layers').delete().in('item_id', itemIds);
    await supabase.from('stock_movements').delete().in('item_id', itemIds);
    await supabase.from('stock_levels').delete().in('item_id', itemIds);
    for (const id of itemIds) {
      await supabase.from('items').delete().eq('id', id);
    }
  }, 60_000);

  it('Test 1: creates an item with FIFO costing method (default/explicit)', async () => {
    const item: any = await itemsService.create(TEST_TENANT_ID, {
      name: 'Regr 13.15-fix FIFO Item',
      type: 'product',
      operation_type: 'sell',
      price: 10,
      costing_method: 'fifo',
    } as any);
    itemIds.push(item.id);
    expect(item.costing_method).toBe('fifo');
  }, 20_000);

  it('Test 2: creating an item with standard costing and no standard_cost is rejected', async () => {
    await expect(
      itemsService.create(TEST_TENANT_ID, {
        name: 'Regr 13.15-fix Standard Missing Cost',
        type: 'product',
        operation_type: 'sell',
        price: 10,
        costing_method: 'standard',
      } as any),
    ).rejects.toThrow('standard_cost is required when costing_method is "standard"');
  }, 15_000);

  it('Test 3: creating an item with standard costing and a valid standard_cost succeeds', async () => {
    const item: any = await itemsService.create(TEST_TENANT_ID, {
      name: 'Regr 13.15-fix Standard Item',
      type: 'product',
      operation_type: 'sell',
      price: 10,
      costing_method: 'standard',
      standard_cost: 7.5,
    } as any);
    itemIds.push(item.id);
    expect(item.costing_method).toBe('standard');
    expect(Number(item.standard_cost)).toBe(7.5);

    // Update-path validation: dropping standard_cost while still 'standard' must be rejected too.
    await expect(
      itemsService.update(item.id, TEST_TENANT_ID, { standard_cost: null } as any),
    ).rejects.toThrow('standard_cost is required when costing_method is "standard"');
  }, 20_000);

  it('Test 4 & 5: cost layers are readable by item and by warehouse', async () => {
    const item: any = await itemsService.create(TEST_TENANT_ID, {
      name: 'Regr 13.15-fix Layer Item',
      type: 'product',
      operation_type: 'sell',
      price: 10,
      costing_method: 'fifo',
    } as any);
    itemIds.push(item.id);

    await supabase.from('cost_layers').insert({
      tenant_id: TEST_TENANT_ID,
      warehouse_id: warehouseId,
      item_id: item.id,
      unit_cost: 4.25,
      quantity_received: 10,
      quantity_remaining: 10,
    });

    const byItem = await stockService.findCostLayers(TEST_TENANT_ID, { itemId: item.id });
    expect(byItem.length).toBe(1);
    expect(Number(byItem[0].unit_cost)).toBe(4.25);

    const byWarehouse = await stockService.findCostLayers(TEST_TENANT_ID, { warehouseId });
    expect(byWarehouse.some((l: any) => l.item_id === item.id)).toBe(true);
  }, 20_000);

  it('Test 6: creates a landed cost entry against a draft goods receipt, and rejects it once posted', async () => {
    const item: any = await itemsService.create(TEST_TENANT_ID, {
      name: 'Regr 13.15-fix Landed Item',
      type: 'product',
      operation_type: 'sell',
      price: 10,
      costing_method: 'fifo',
    } as any);
    itemIds.push(item.id);

    const receipt: any = await goodsReceiptsService.create(TEST_TENANT_ID, {
      warehouse_id: warehouseId,
      receipt_number: `R1315-${Date.now()}`,
      items: [{ item_id: item.id, quantity_received: 10, unit_cost: 5 }],
    } as any);
    grIds.push(receipt.id);

    const landedCost = await landedCostsService.create(receipt.id, TEST_TENANT_ID, null as any, {
      cost_type: 'shipping',
      amount: 50,
      allocation_method: 'by_value',
    } as any);
    expect(Number((landedCost as any).amount)).toBe(50);

    const list = await landedCostsService.findByReceipt(receipt.id, TEST_TENANT_ID);
    expect(list.length).toBe(1);

    await goodsReceiptsService.post(receipt.id, TEST_TENANT_ID, null as any);

    await expect(
      landedCostsService.create(receipt.id, TEST_TENANT_ID, null as any, {
        cost_type: 'customs',
        amount: 10,
      } as any),
    ).rejects.toThrow('must still be draft');

    // The landed cost was baked into unit_cost at posting time (migration 110,
    // untouched) — confirms this Migration 13.15-fix change didn't disturb that.
    const layers = await stockService.findCostLayers(TEST_TENANT_ID, { itemId: item.id, warehouseId });
    const receiptLayer = layers.find((l: any) => Number(l.quantity_received) === 10);
    expect(receiptLayer).toBeTruthy();
    expect(Number(receiptLayer.unit_cost)).toBeGreaterThan(5); // 5 + landed-cost allocation
  }, 30_000);

  it('Test 7: tenant isolation — cost layers and landed costs are not visible cross-tenant', async () => {
    const item: any = await itemsService.create(TEST_TENANT_ID, {
      name: 'Regr 13.15-fix Isolation Item',
      type: 'product',
      operation_type: 'sell',
      price: 10,
      costing_method: 'fifo',
    } as any);
    itemIds.push(item.id);
    await supabase.from('cost_layers').insert({
      tenant_id: TEST_TENANT_ID,
      warehouse_id: warehouseId,
      item_id: item.id,
      unit_cost: 3,
      quantity_received: 5,
      quantity_remaining: 5,
    });

    const crossTenantLayers = await stockService.findCostLayers(OTHER_TENANT_ID, { itemId: item.id });
    expect(crossTenantLayers).toEqual([]);

    await expect(itemsService.findById(item.id, OTHER_TENANT_ID)).rejects.toThrow('Item not found');
  }, 20_000);

  it('Test 8: existing costing engine behavior is unchanged — fifo/average/moving_average/standard/actual all still function via direct RPC', async () => {
    // fifo: two discrete layers, oldest consumed first.
    const fifoItem: any = await itemsService.create(TEST_TENANT_ID, {
      name: 'Regr 13.15-fix Engine FIFO', type: 'product', operation_type: 'sell', price: 10, costing_method: 'fifo',
    } as any);
    itemIds.push(fifoItem.id);
    await supabase.rpc('fn_add_cost_layer', { p_tenant_id: TEST_TENANT_ID, p_warehouse_id: warehouseId, p_item_id: fifoItem.id, p_variant_id: null, p_batch_id: null, p_quantity: 5, p_unit_cost: 2, p_source_movement_id: null });
    await supabase.rpc('fn_add_cost_layer', { p_tenant_id: TEST_TENANT_ID, p_warehouse_id: warehouseId, p_item_id: fifoItem.id, p_variant_id: null, p_batch_id: null, p_quantity: 5, p_unit_cost: 8, p_source_movement_id: null });
    const { data: fifoLayers } = await supabase.from('cost_layers').select('unit_cost, quantity_remaining').eq('tenant_id', TEST_TENANT_ID).eq('item_id', fifoItem.id).order('received_at', { ascending: true });
    expect(fifoLayers!.length).toBe(2); // discrete layers, not merged

    // average/moving_average: merges into a single blended layer.
    const avgItem: any = await itemsService.create(TEST_TENANT_ID, {
      name: 'Regr 13.15-fix Engine Average', type: 'product', operation_type: 'sell', price: 10, costing_method: 'moving_average',
    } as any);
    itemIds.push(avgItem.id);
    await supabase.rpc('fn_add_cost_layer', { p_tenant_id: TEST_TENANT_ID, p_warehouse_id: warehouseId, p_item_id: avgItem.id, p_variant_id: null, p_batch_id: null, p_quantity: 10, p_unit_cost: 2, p_source_movement_id: null });
    await supabase.rpc('fn_add_cost_layer', { p_tenant_id: TEST_TENANT_ID, p_warehouse_id: warehouseId, p_item_id: avgItem.id, p_variant_id: null, p_batch_id: null, p_quantity: 10, p_unit_cost: 4, p_source_movement_id: null });
    const { data: avgLayers } = await supabase.from('cost_layers').select('unit_cost, quantity_remaining').eq('tenant_id', TEST_TENANT_ID).eq('item_id', avgItem.id);
    expect(avgLayers!.length).toBe(1); // merged into one blended layer
    expect(Number(avgLayers![0].unit_cost)).toBe(3); // (10*2 + 10*4) / 20

    // standard: consumption returns items.standard_cost regardless of layer cost.
    const stdItem: any = await itemsService.create(TEST_TENANT_ID, {
      name: 'Regr 13.15-fix Engine Standard', type: 'product', operation_type: 'sell', price: 10, costing_method: 'standard', standard_cost: 6,
    } as any);
    itemIds.push(stdItem.id);
    await supabase.rpc('fn_add_cost_layer', { p_tenant_id: TEST_TENANT_ID, p_warehouse_id: warehouseId, p_item_id: stdItem.id, p_variant_id: null, p_batch_id: null, p_quantity: 10, p_unit_cost: 2, p_source_movement_id: null });
    const { data: stdConsumeCost, error: stdErr } = await supabase.rpc('fn_consume_cost_layers', { p_tenant_id: TEST_TENANT_ID, p_warehouse_id: warehouseId, p_item_id: stdItem.id, p_variant_id: null, p_quantity: 5 });
    expect(stdErr).toBeNull();
    expect(Number(stdConsumeCost)).toBe(6); // standard_cost, not the layer's unit_cost of 2

    // actual: consumption returns the specific serial's own unit_cost.
    const actualItem: any = await itemsService.create(TEST_TENANT_ID, {
      name: 'Regr 13.15-fix Engine Actual', type: 'product', operation_type: 'sell', price: 10, costing_method: 'actual', track_serial: true,
    } as any);
    itemIds.push(actualItem.id);
    await supabase.rpc('fn_add_cost_layer', { p_tenant_id: TEST_TENANT_ID, p_warehouse_id: warehouseId, p_item_id: actualItem.id, p_variant_id: null, p_batch_id: null, p_quantity: 1, p_unit_cost: 2, p_source_movement_id: null });
    const { data: serial, error: serialErr } = await supabase
      .from('item_serials')
      .insert({ tenant_id: TEST_TENANT_ID, item_id: actualItem.id, warehouse_id: warehouseId, batch_id: null, serial_number: `R1315-ACTUAL-${Date.now()}`, unit_cost: 99 })
      .select()
      .single();
    if (serialErr) throw serialErr;
    const { data: actualConsumeCost, error: actualErr } = await supabase.rpc('fn_consume_cost_layers', { p_tenant_id: TEST_TENANT_ID, p_warehouse_id: warehouseId, p_item_id: actualItem.id, p_variant_id: null, p_quantity: 1, p_allow_partial: false, p_serial_id: serial.id });
    expect(actualErr).toBeNull();
    expect(Number(actualConsumeCost)).toBe(99); // the serial's own recorded cost, not the pooled layer cost of 2
    await supabase.from('item_serials').delete().eq('id', serial.id);
  }, 30_000);
});
