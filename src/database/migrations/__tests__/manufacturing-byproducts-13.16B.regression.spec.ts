/**
 * Regression suite for Migration 13.16B (Manufacturing By-products, #16).
 * Runs directly against the real shared Supabase project via the
 * service-role client — same convention as
 * manufacturing-routing-scrap-13.16A.regression.spec.ts.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

import { ProductionOrdersService } from '../../../modules/manufacturing/production-orders.service';
import { ProductionOrdersRepository } from '../../../modules/manufacturing/repositories/production-orders.repository';
import { BomRepository } from '../../../modules/manufacturing/repositories/bom.repository';
import { OwnershipRepository } from '../../../modules/ownership/repositories/ownership.repository';
import { OperationsService } from '../../../modules/manufacturing/operations.service';
import { OperationsRepository } from '../../../modules/manufacturing/repositories/operations.repository';
import { ScrapService } from '../../../modules/manufacturing/scrap.service';
import { ScrapRepository } from '../../../modules/manufacturing/repositories/scrap.repository';
import { OutputsService } from '../../../modules/manufacturing/outputs.service';
import { OutputsRepository } from '../../../modules/manufacturing/repositories/outputs.repository';

const TEST_TENANT_ID = '9bcd3369-d664-47c8-b297-3bc9b429aacf'; // Sefay Demo
const OTHER_TENANT_ID = '00000000-0000-0000-0000-000000000007';

describe('manufacturing by-products regression (Migration 13.16B)', () => {
  let supabase: SupabaseClient;
  let productionOrdersService: ProductionOrdersService;
  let outputsService: OutputsService;
  let warehouseId: string;
  const itemIds: string[] = [];
  const bomIds: string[] = [];
  const orderIds: string[] = [];
  const grIds: string[] = [];

  const createItem = async (name: string) => {
    const { data, error } = await supabase
      .from('items')
      .insert({ tenant_id: TEST_TENANT_ID, name, type: 'product', operation_type: 'sell', price: 5, is_active: true })
      .select()
      .single();
    if (error) throw error;
    itemIds.push(data.id);
    return data.id;
  };

  const seedStock = async (itemId: string, qty: number, unitCost: number) => {
    const { data: gr, error: grErr } = await supabase
      .from('goods_receipts')
      .insert({ tenant_id: TEST_TENANT_ID, warehouse_id: warehouseId, receipt_number: `MFG1316B-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, status: 'draft' })
      .select()
      .single();
    if (grErr) throw grErr;
    grIds.push(gr.id);
    const { error: lineErr } = await supabase.from('goods_receipt_items').insert({
      tenant_id: TEST_TENANT_ID, goods_receipt_id: gr.id, item_id: itemId, quantity_received: qty, unit_cost: unitCost,
    });
    if (lineErr) throw lineErr;
    const { error: postErr } = await supabase.rpc('fn_post_goods_receipt', { p_goods_receipt_id: gr.id, p_actor_id: null });
    if (postErr) throw postErr;
  };

  const createBom = async (finishedItemId: string, componentItemId: string, qtyPerUnit: number) => {
    const { data: bom, error: bomErr } = await supabase
      .from('bill_of_materials')
      .insert({ tenant_id: TEST_TENANT_ID, item_id: finishedItemId, is_active: true })
      .select()
      .single();
    if (bomErr) throw bomErr;
    bomIds.push(bom.id);
    const { error: lineErr } = await supabase.from('bom_lines').insert({
      tenant_id: TEST_TENANT_ID, bom_id: bom.id, component_item_id: componentItemId, quantity_per_unit: qtyPerUnit, scrap_percentage: 0,
    });
    if (lineErr) throw lineErr;
    return bom.id;
  };

  const createOrder = async (bomId: string, quantityPlanned: number) => {
    const { data, error } = await supabase
      .from('production_orders')
      .insert({
        tenant_id: TEST_TENANT_ID, warehouse_id: warehouseId, bom_id: bomId,
        order_number: `MFG1316B-PO-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        quantity_planned: quantityPlanned, status: 'in_progress', started_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (error) throw error;
    orderIds.push(data.id);
    return data.id;
  };

  beforeAll(async () => {
    supabase = createClient(process.env.SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string);

    const { data: wh, error: whErr } = await supabase.from('warehouses').select('id').eq('tenant_id', TEST_TENANT_ID).limit(1).single();
    if (whErr) throw whErr;
    warehouseId = wh.id;

    const productionOrdersRepo = new ProductionOrdersRepository(supabase);
    const bomRepo = new BomRepository(supabase);
    const ownershipRepo = new OwnershipRepository(supabase);
    const operationsService = new OperationsService(new OperationsRepository(supabase), productionOrdersRepo);
    const scrapService = new ScrapService(new ScrapRepository(supabase), productionOrdersRepo);
    const outputsRepo = new OutputsRepository(supabase);
    outputsService = new OutputsService(outputsRepo, productionOrdersRepo);

    productionOrdersService = new ProductionOrdersService(
      productionOrdersRepo,
      bomRepo,
      {} as any,
      {} as any,
      { invalidateStockCache: async () => undefined } as any,
      {} as any,
      ownershipRepo,
      {} as any,
      operationsService,
      scrapService,
      outputsService,
      {} as any,
      {} as any,
    );
  }, 30_000);

  afterAll(async () => {
    for (const id of orderIds) {
      await supabase.from('production_order_outputs').delete().eq('production_order_id', id);
    }
    await supabase.from('stock_movements').delete().in('item_id', itemIds);
    await supabase.from('cost_layers').delete().in('item_id', itemIds);
    await supabase.from('stock_levels').delete().in('item_id', itemIds);
    for (const id of orderIds) {
      await supabase.from('production_orders').delete().eq('id', id);
    }
    for (const id of bomIds) {
      await supabase.from('bom_lines').delete().eq('bom_id', id);
      await supabase.from('bill_of_materials').delete().eq('id', id);
    }
    for (const id of grIds) {
      await supabase.from('goods_receipt_items').delete().eq('goods_receipt_id', id);
      await supabase.from('goods_receipts').delete().eq('id', id);
    }
    for (const id of itemIds) {
      await supabase.from('items').delete().eq('id', id);
    }
  }, 60_000);

  it('Test 1: existing production order without by-products completes unchanged', async () => {
    const component = await createItem('Regr 13.16B Component Plain');
    const finished = await createItem('Regr 13.16B Finished Plain');
    await seedStock(component, 100, 3);
    const bomId = await createBom(finished, component, 2);
    const orderId = await createOrder(bomId, 10);

    const result: any = await productionOrdersService.complete(orderId, TEST_TENANT_ID, null, {});
    expect(result.status).toBe('completed');
    expect(Number(result.quantity_produced)).toBe(10);

    // The main-product output row is still recorded (informational only —
    // Migration 13.16B's own visibility feature), but there must be zero
    // by_product rows since none were ever created.
    const outputs: any[] = await outputsService.findByProductionOrder(orderId, TEST_TENANT_ID);
    expect(outputs.length).toBe(1);
    expect(outputs[0].output_type).toBe('main_product');
  }, 30_000);

  it('Test 2: a by-product output can be planned ahead of completion', async () => {
    const component = await createItem('Regr 13.16B Component Plan');
    const finished = await createItem('Regr 13.16B Finished Plan');
    const byProduct = await createItem('Regr 13.16B ByProduct Plan');
    await seedStock(component, 100, 4);
    const bomId = await createBom(finished, component, 1);
    const orderId = await createOrder(bomId, 5);

    const output: any = await outputsService.create(orderId, TEST_TENANT_ID, {
      item_id: byProduct, quantity: 2, unit_cost: 1.5,
    } as any);
    expect(output.output_type).toBe('by_product');
    expect(output.movement_id).toBeNull();
  }, 20_000);

  it('Test 3, 4, 5, 6: completing with a by-product posts both receipts, cost layers and stock movements are correct', async () => {
    const component = await createItem('Regr 13.16B Component Complete');
    const finished = await createItem('Regr 13.16B Finished Complete');
    const byProduct = await createItem('Regr 13.16B ByProduct Complete');
    await seedStock(component, 100, 5);
    const bomId = await createBom(finished, component, 1);
    const orderId = await createOrder(bomId, 4);

    await outputsService.create(orderId, TEST_TENANT_ID, { item_id: byProduct, quantity: 3, unit_cost: 2 } as any);

    const result: any = await productionOrdersService.complete(orderId, TEST_TENANT_ID, null, {});
    expect(result.status).toBe('completed');

    // Test 4: both receipts exist as real stock_movements rows.
    const { data: movements } = await supabase
      .from('stock_movements')
      .select('item_id, movement_type, direction, quantity, unit_cost')
      .eq('reference_type', 'production_order')
      .eq('reference_id', orderId)
      .eq('movement_type', 'production_receipt');
    expect(movements!.length).toBe(2); // main product + by-product
    const mainReceipt = movements!.find((m) => m.item_id === finished);
    const byProductReceipt = movements!.find((m) => m.item_id === byProduct);
    expect(mainReceipt).toBeTruthy();
    expect(Number(mainReceipt!.quantity)).toBe(4);
    expect(Number(mainReceipt!.unit_cost)).toBe(5); // unaffected by the by-product — main cost calc untouched
    expect(byProductReceipt).toBeTruthy();
    expect(Number(byProductReceipt!.quantity)).toBe(3);
    expect(Number(byProductReceipt!.unit_cost)).toBe(2); // its own independently-specified cost

    // Test 5: cost layers exist for both outputs.
    const { data: mainLayers } = await supabase.from('cost_layers').select('quantity_remaining, unit_cost').eq('tenant_id', TEST_TENANT_ID).eq('item_id', finished);
    expect(mainLayers!.length).toBe(1);
    expect(Number(mainLayers![0].quantity_remaining)).toBe(4);
    const { data: byProductLayers } = await supabase.from('cost_layers').select('quantity_remaining, unit_cost').eq('tenant_id', TEST_TENANT_ID).eq('item_id', byProduct);
    expect(byProductLayers!.length).toBe(1);
    expect(Number(byProductLayers![0].quantity_remaining)).toBe(3);
    expect(Number(byProductLayers![0].unit_cost)).toBe(2);

    // Test 6: stock_levels reflect both receipts correctly (ledger integrity).
    const { data: mainLevel } = await supabase.from('stock_levels').select('quantity_on_hand').eq('tenant_id', TEST_TENANT_ID).eq('item_id', finished).eq('warehouse_id', warehouseId).is('location_id', null).single();
    expect(Number(mainLevel!.quantity_on_hand)).toBe(4);
    const { data: byProductLevel } = await supabase.from('stock_levels').select('quantity_on_hand').eq('tenant_id', TEST_TENANT_ID).eq('item_id', byProduct).eq('warehouse_id', warehouseId).is('location_id', null).single();
    expect(Number(byProductLevel!.quantity_on_hand)).toBe(3);

    // The output rows themselves are now both marked posted (movement_id set).
    const outputs: any[] = await outputsService.findByProductionOrder(orderId, TEST_TENANT_ID);
    expect(outputs.length).toBe(2);
    expect(outputs.every((o) => o.movement_id !== null)).toBe(true);
  }, 30_000);

  it('Test 7: tenant isolation — outputs from another tenant are not accessible', async () => {
    const component = await createItem('Regr 13.16B Component Iso');
    const finished = await createItem('Regr 13.16B Finished Iso');
    await seedStock(component, 10, 1);
    const bomId = await createBom(finished, component, 1);
    const orderId = await createOrder(bomId, 1);
    await outputsService.create(orderId, TEST_TENANT_ID, { item_id: finished, quantity: 1, unit_cost: 1 } as any);

    const crossTenantOutputs = await outputsService.findByProductionOrder(orderId, OTHER_TENANT_ID);
    expect(crossTenantOutputs).toEqual([]);
  }, 20_000);
});
