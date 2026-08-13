/**
 * Regression suite for Migration 13.16A (Manufacturing Routing + Scrap
 * Tracking, #16). Runs directly against the real shared Supabase project
 * via the service-role client — same convention as
 * manufacturing-locations.regression.spec.ts. Exercises the real
 * OperationsService/ScrapService/ProductionOrdersService classes directly.
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
const OTHER_TENANT_ID = '00000000-0000-0000-0000-000000000006';

describe('manufacturing routing + scrap regression (Migration 13.16A)', () => {
  let supabase: SupabaseClient;
  let productionOrdersService: ProductionOrdersService;
  let operationsService: OperationsService;
  let scrapService: ScrapService;
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
      .insert({ tenant_id: TEST_TENANT_ID, warehouse_id: warehouseId, receipt_number: `MFG1316A-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, status: 'draft' })
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
        order_number: `MFG1316A-PO-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
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
    const operationsRepo = new OperationsRepository(supabase);
    const scrapRepo = new ScrapRepository(supabase);
    const outputsRepo = new OutputsRepository(supabase);
    operationsService = new OperationsService(operationsRepo, productionOrdersRepo);
    scrapService = new ScrapService(scrapRepo, productionOrdersRepo);
    const outputsService = new OutputsService(outputsRepo, productionOrdersRepo);

    // warehousesService/locationsService/itemsService are never touched by
    // complete() itself (only by create()/update(), which this suite
    // doesn't exercise — orders are seeded directly, matching
    // manufacturing-locations.regression.spec.ts's own convention);
    // stockService/auditService calls inside complete() are both
    // safe no-ops for this suite's purposes (cache invalidation, and audit
    // logging is skipped entirely when actorId is null).
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
      await supabase.from('production_order_scraps').delete().eq('production_order_id', id);
      await supabase.from('production_order_operations').delete().eq('production_order_id', id);
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

  it('Test 1 & 8: production order completes without routing/scrap exactly as before (backward compatibility)', async () => {
    const component = await createItem('Regr 13.16A Component Plain');
    const finished = await createItem('Regr 13.16A Finished Plain');
    await seedStock(component, 100, 3);
    const bomId = await createBom(finished, component, 2);
    const orderId = await createOrder(bomId, 10);

    const result: any = await productionOrdersService.complete(orderId, TEST_TENANT_ID, null, {});
    expect(result.status).toBe('completed');
    expect(Number(result.quantity_produced)).toBe(10);

    const { data: receiptMovement } = await supabase
      .from('stock_movements')
      .select('quantity, unit_cost')
      .eq('reference_id', orderId)
      .eq('movement_type', 'production_receipt')
      .single();
    expect(Number(receiptMovement!.quantity)).toBe(10);
    expect(Number(receiptMovement!.unit_cost)).toBe(6); // 2 components * 3 unit_cost
  }, 30_000);

  it('Test 2 & 3: operations can be added to a production order, and sequence is maintained', async () => {
    const component = await createItem('Regr 13.16A Component Ops');
    const finished = await createItem('Regr 13.16A Finished Ops');
    await seedStock(component, 100, 2);
    const bomId = await createBom(finished, component, 1);
    const orderId = await createOrder(bomId, 5);

    await operationsService.create(orderId, TEST_TENANT_ID, { sequence: 2, operation_name: 'Assembly' } as any);
    await operationsService.create(orderId, TEST_TENANT_ID, { sequence: 1, operation_name: 'Cutting' } as any);
    await operationsService.create(orderId, TEST_TENANT_ID, { sequence: 3, operation_name: 'Finishing' } as any);

    const ops: any[] = await operationsService.findByProductionOrder(orderId, TEST_TENANT_ID);
    expect(ops.length).toBe(3);
    expect(ops.map((o) => o.operation_name)).toEqual(['Cutting', 'Assembly', 'Finishing']); // ordered by sequence, not insertion order
  }, 30_000);

  it('Test: routing gate blocks completion until all operations are completed, then allows it', async () => {
    const component = await createItem('Regr 13.16A Component Gate');
    const finished = await createItem('Regr 13.16A Finished Gate');
    await seedStock(component, 100, 4);
    const bomId = await createBom(finished, component, 1);
    const orderId = await createOrder(bomId, 3);

    const op1: any = await operationsService.create(orderId, TEST_TENANT_ID, { sequence: 1, operation_name: 'Step 1' } as any);
    await operationsService.create(orderId, TEST_TENANT_ID, { sequence: 2, operation_name: 'Step 2' } as any);

    await expect(productionOrdersService.complete(orderId, TEST_TENANT_ID, null, {})).rejects.toThrow('not yet completed');

    await operationsService.update(op1.id, orderId, TEST_TENANT_ID, { status: 'completed' } as any);
    await expect(productionOrdersService.complete(orderId, TEST_TENANT_ID, null, {})).rejects.toThrow('not yet completed'); // Step 2 still pending

    const allOps: any[] = await operationsService.findByProductionOrder(orderId, TEST_TENANT_ID);
    const op2 = allOps.find((o) => o.operation_name === 'Step 2');
    await operationsService.update(op2.id, orderId, TEST_TENANT_ID, { status: 'completed' } as any);

    const result: any = await productionOrdersService.complete(orderId, TEST_TENANT_ID, null, {});
    expect(result.status).toBe('completed');
  }, 30_000);

  it('Test 4: tenant isolation — operations from another tenant are not accessible', async () => {
    const component = await createItem('Regr 13.16A Component Iso');
    const finished = await createItem('Regr 13.16A Finished Iso');
    await seedStock(component, 10, 1);
    const bomId = await createBom(finished, component, 1);
    const orderId = await createOrder(bomId, 1);
    await operationsService.create(orderId, TEST_TENANT_ID, { sequence: 1, operation_name: 'Solo Step' } as any);

    const crossTenantOps = await operationsService.findByProductionOrder(orderId, OTHER_TENANT_ID);
    expect(crossTenantOps).toEqual([]);
  }, 20_000);

  it('Test 5, 6, 9, 10: recording a scrap event posts a correct, distinct stock movement, cost layers/ledger remain valid', async () => {
    const component = await createItem('Regr 13.16A Component Scrap');
    const finished = await createItem('Regr 13.16A Finished Scrap');
    await seedStock(finished, 50, 10); // seed the FINISHED item itself so we can scrap a defective unit of it
    const bomId = await createBom(finished, component, 1);
    const orderId = await createOrder(bomId, 1);

    const before = await supabase.from('stock_levels').select('quantity_on_hand').eq('tenant_id', TEST_TENANT_ID).eq('item_id', finished).eq('warehouse_id', warehouseId).is('location_id', null).single();

    const scrap: any = await scrapService.record(orderId, TEST_TENANT_ID, null, { item_id: finished, quantity: 5, reason: 'Defective units' } as any);
    expect(Number(scrap.quantity)).toBe(5);
    expect(Number(scrap.unit_cost)).toBe(10);
    expect(scrap.reason).toBe('Defective units');

    // Test 6: a real, distinct stock_movements row — not consumption, not receipt.
    const { data: movement } = await supabase
      .from('stock_movements')
      .select('movement_type, direction, quantity, reference_type, reference_id')
      .eq('id', scrap.movement_id)
      .single();
    expect(movement!.movement_type).toBe('production_scrap');
    expect(movement!.direction).toBe('out');
    expect(Number(movement!.quantity)).toBe(5);
    expect(movement!.reference_type).toBe('production_order');
    expect(movement!.reference_id).toBe(orderId);

    // Test 9: cost_layers were really drawn from (quantity_remaining decreased) — scrap has real cost impact.
    const { data: layers } = await supabase.from('cost_layers').select('quantity_remaining').eq('tenant_id', TEST_TENANT_ID).eq('item_id', finished);
    const totalRemaining = layers!.reduce((s, l) => s + Number(l.quantity_remaining), 0);
    expect(totalRemaining).toBe(45); // 50 seeded - 5 scrapped

    // Test 10: stock_levels reflects the same reduction — ledger is internally consistent.
    const after = await supabase.from('stock_levels').select('quantity_on_hand').eq('tenant_id', TEST_TENANT_ID).eq('item_id', finished).eq('warehouse_id', warehouseId).is('location_id', null).single();
    expect(Number(after.data!.quantity_on_hand)).toBe(Number(before.data!.quantity_on_hand) - 5);

    const list = await scrapService.findByProductionOrder(orderId, TEST_TENANT_ID);
    expect(list.length).toBe(1);
  }, 30_000);

  it('Test 7: production completion posts scrap together with the completion RPC when provided', async () => {
    const component = await createItem('Regr 13.16A Component CompleteScrap');
    const finished = await createItem('Regr 13.16A Finished CompleteScrap');
    await seedStock(component, 50, 5);
    const bomId = await createBom(finished, component, 1);
    const orderId = await createOrder(bomId, 4);

    const result: any = await productionOrdersService.complete(orderId, TEST_TENANT_ID, null, {
      scrap: [{ item_id: finished, quantity: 1, reason: 'Damaged on completion' } as any],
    });
    expect(result.status).toBe('completed');

    const scrapRows = await scrapService.findByProductionOrder(orderId, TEST_TENANT_ID);
    expect(scrapRows.length).toBe(1);
    expect(Number((scrapRows[0] as any).quantity)).toBe(1);

    const { data: scrapMovement } = await supabase
      .from('stock_movements')
      .select('movement_type')
      .eq('reference_id', orderId)
      .eq('movement_type', 'production_scrap')
      .maybeSingle();
    expect(scrapMovement).toBeTruthy();
  }, 30_000);
});
