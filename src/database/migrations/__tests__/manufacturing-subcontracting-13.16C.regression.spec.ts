/**
 * Regression suite for Migration 13.16C (Manufacturing Subcontracting, #16
 * — final sub-scope). Runs directly against the real shared Supabase
 * project via the service-role client — same convention as
 * manufacturing-byproducts-13.16B.regression.spec.ts.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

import { SubcontractOrdersService } from '../../../modules/manufacturing/subcontract-orders.service';
import { SubcontractOrdersRepository } from '../../../modules/manufacturing/repositories/subcontract-orders.repository';
import { SuppliersService } from '../../../modules/purchasing/suppliers.service';
import { SuppliersRepository } from '../../../modules/purchasing/repositories/suppliers.repository';
import { WarehousesService } from '../../../modules/inventory/warehouses.service';
import { WarehousesRepository } from '../../../modules/inventory/repositories/warehouses.repository';
import { ItemsService } from '../../../modules/items/items.service';
import { ItemsRepository } from '../../../modules/items/repositories/items.repository';

const TEST_TENANT_ID = '9bcd3369-d664-47c8-b297-3bc9b429aacf'; // Sefay Demo
const OTHER_TENANT_ID = '00000000-0000-0000-0000-000000000008';
const fakeCache = {
  get: async () => null,
  set: async () => undefined,
  delByPrefix: async () => undefined,
} as any;
const fakeBarcodesService = { generateForItem: async () => undefined } as any;

describe('manufacturing subcontracting regression (Migration 13.16C)', () => {
  let supabase: SupabaseClient;
  let subcontractOrdersService: SubcontractOrdersService;
  let suppliersService: SuppliersService;
  let itemsService: ItemsService;
  let warehouseId: string;
  const itemIds: string[] = [];
  const supplierIds: string[] = [];
  const orderIds: string[] = [];
  const productionOrderIds: string[] = [];
  const bomIds: string[] = [];
  const grIds: string[] = [];

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

  const seedStock = async (itemId: string, qty: number, unitCost: number) => {
    const { data: gr, error: grErr } = await supabase
      .from('goods_receipts')
      .insert({
        tenant_id: TEST_TENANT_ID,
        warehouse_id: warehouseId,
        receipt_number: `MFG1316C-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
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

  beforeAll(async () => {
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    );

    const { data: wh, error: whErr } = await supabase
      .from('warehouses')
      .select('id')
      .eq('tenant_id', TEST_TENANT_ID)
      .limit(1)
      .single();
    if (whErr) throw whErr;
    warehouseId = wh.id;

    const suppliersRepo = new SuppliersRepository(supabase);
    suppliersService = new SuppliersService(suppliersRepo);

    const warehousesRepo = new WarehousesRepository(supabase);
    const warehousesService = new WarehousesService(warehousesRepo);

    const itemsRepo = new ItemsRepository(supabase);
    itemsService = new ItemsService(itemsRepo, fakeCache, fakeBarcodesService);

    const subcontractOrdersRepo = new SubcontractOrdersRepository(supabase);
    subcontractOrdersService = new SubcontractOrdersService(
      subcontractOrdersRepo,
      suppliersService,
      warehousesService,
      itemsService,
    );
  }, 30_000);

  afterAll(async () => {
    for (const id of orderIds) {
      await supabase
        .from('subcontract_costs')
        .delete()
        .eq('subcontract_order_id', id);
      await supabase
        .from('subcontract_order_lines')
        .delete()
        .eq('subcontract_order_id', id);
    }
    await supabase.from('stock_movements').delete().in('item_id', itemIds);
    await supabase.from('cost_layers').delete().in('item_id', itemIds);
    await supabase.from('stock_levels').delete().in('item_id', itemIds);
    for (const id of orderIds) {
      await supabase.from('subcontract_orders').delete().eq('id', id);
    }
    for (const id of productionOrderIds) {
      await supabase.from('production_orders').delete().eq('id', id);
    }
    for (const id of bomIds) {
      await supabase.from('bom_lines').delete().eq('bom_id', id);
      await supabase.from('bill_of_materials').delete().eq('id', id);
    }
    for (const id of grIds) {
      await supabase
        .from('goods_receipt_items')
        .delete()
        .eq('goods_receipt_id', id);
      await supabase.from('goods_receipts').delete().eq('id', id);
    }
    for (const id of supplierIds) {
      await supabase.from('suppliers').delete().eq('id', id);
    }
    for (const id of itemIds) {
      await supabase.from('items').delete().eq('id', id);
    }
  }, 60_000);

  it('Test 2: a supplier can be marked as a subcontractor, existing suppliers unaffected', async () => {
    const plain: any = await suppliersService.create(TEST_TENANT_ID, {
      name: 'Regr 13.16C Plain Supplier',
    });
    supplierIds.push(plain.id);
    expect(plain.is_subcontractor).toBe(false); // default preserved

    const subcontractor: any = await suppliersService.create(TEST_TENANT_ID, {
      name: 'Regr 13.16C Subcontractor',
      is_subcontractor: true,
    });
    supplierIds.push(subcontractor.id);
    expect(subcontractor.is_subcontractor).toBe(true);
  }, 20_000);

  it('Test 1: creates a subcontract order with lines, rejecting a non-subcontractor supplier', async () => {
    const plainSupplier: any = await suppliersService.create(TEST_TENANT_ID, {
      name: 'Regr 13.16C Plain For Reject',
    });
    supplierIds.push(plainSupplier.id);
    const material = await createItem('Regr 13.16C Material Create');
    const output = await createItem('Regr 13.16C Output Create');

    await expect(
      subcontractOrdersService.create(TEST_TENANT_ID, null, {
        supplier_id: plainSupplier.id,
        warehouse_id: warehouseId,
        order_number: `MFG1316C-REJ-${Date.now()}`,
        lines: [
          {
            material_item_id: material,
            quantity_sent: 5,
            output_item_id: output,
            output_quantity: 4,
          },
        ],
      } as any),
    ).rejects.toThrow('not marked as a subcontractor');

    const subcontractor: any = await suppliersService.create(TEST_TENANT_ID, {
      name: 'Regr 13.16C Sub For Create',
      is_subcontractor: true,
    });
    supplierIds.push(subcontractor.id);

    const order: any = await subcontractOrdersService.create(
      TEST_TENANT_ID,
      null,
      {
        supplier_id: subcontractor.id,
        warehouse_id: warehouseId,
        order_number: `MFG1316C-CREATE-${Date.now()}`,
        lines: [
          {
            material_item_id: material,
            quantity_sent: 5,
            output_item_id: output,
            output_quantity: 4,
          },
        ],
      },
    );
    orderIds.push(order.id);
    expect(order.status).toBe('draft');
    expect(order.lines.length).toBe(1);
  }, 30_000);

  it('Test 3, 4: sending materials externally posts a subcontract_out movement and decreases stock', async () => {
    const subcontractor: any = await suppliersService.create(TEST_TENANT_ID, {
      name: 'Regr 13.16C Sub Send',
      is_subcontractor: true,
    });
    supplierIds.push(subcontractor.id);
    const material = await createItem('Regr 13.16C Material Send');
    const output = await createItem('Regr 13.16C Output Send');
    await seedStock(material, 20, 4);

    const order: any = await subcontractOrdersService.create(
      TEST_TENANT_ID,
      null,
      {
        supplier_id: subcontractor.id,
        warehouse_id: warehouseId,
        order_number: `MFG1316C-SEND-${Date.now()}`,
        lines: [
          {
            material_item_id: material,
            quantity_sent: 10,
            output_item_id: output,
            output_quantity: 8,
          },
        ],
      },
    );
    orderIds.push(order.id);

    const before = await supabase
      .from('stock_levels')
      .select('quantity_on_hand')
      .eq('tenant_id', TEST_TENANT_ID)
      .eq('item_id', material)
      .eq('warehouse_id', warehouseId)
      .is('location_id', null)
      .single();

    const sent: any = await subcontractOrdersService.send(
      order.id,
      TEST_TENANT_ID,
      null,
    );
    expect(sent.status).toBe('sent');

    const { data: movement } = await supabase
      .from('stock_movements')
      .select('movement_type, direction, quantity, unit_cost')
      .eq('reference_type', 'subcontract_order')
      .eq('reference_id', order.id)
      .eq('movement_type', 'subcontract_out')
      .single();
    expect(movement.direction).toBe('out');
    expect(Number(movement.quantity)).toBe(10);
    expect(Number(movement.unit_cost)).toBe(4);

    const after = await supabase
      .from('stock_levels')
      .select('quantity_on_hand')
      .eq('tenant_id', TEST_TENANT_ID)
      .eq('item_id', material)
      .eq('warehouse_id', warehouseId)
      .is('location_id', null)
      .single();
    expect(Number(after.data.quantity_on_hand)).toBe(
      Number(before.data.quantity_on_hand) - 10,
    );
  }, 30_000);

  it('Test 5, 6, 7, 8: receiving with a service cost posts subcontract_in with material+service cost included', async () => {
    const subcontractor: any = await suppliersService.create(TEST_TENANT_ID, {
      name: 'Regr 13.16C Sub Receive',
      is_subcontractor: true,
    });
    supplierIds.push(subcontractor.id);
    const material = await createItem('Regr 13.16C Material Receive');
    const output = await createItem('Regr 13.16C Output Receive');
    await seedStock(material, 20, 10); // material worth 10/unit

    const order: any = await subcontractOrdersService.create(
      TEST_TENANT_ID,
      null,
      {
        supplier_id: subcontractor.id,
        warehouse_id: warehouseId,
        order_number: `MFG1316C-RECV-${Date.now()}`,
        lines: [
          {
            material_item_id: material,
            quantity_sent: 10,
            output_item_id: output,
            output_quantity: 8,
          },
        ],
      },
    );
    orderIds.push(order.id);
    await subcontractOrdersService.send(order.id, TEST_TENANT_ID, null);

    // Test 7: add a service fee before receiving.
    await subcontractOrdersService.addCost(order.id, TEST_TENANT_ID, null, {
      cost_type: 'service_fee',
      amount: 40,
    } as any);
    const costs = await subcontractOrdersService.findCosts(
      order.id,
      TEST_TENANT_ID,
    );
    expect(costs.length).toBe(1);

    const received: any = await subcontractOrdersService.receive(
      order.id,
      TEST_TENANT_ID,
      null,
    );
    expect(received.status).toBe('received');

    // Test 6: subcontract_in movement exists with cost = (material 10*10=100 + service 40) / 8 output units = 17.5
    const { data: movement } = await supabase
      .from('stock_movements')
      .select('movement_type, direction, quantity, unit_cost')
      .eq('reference_type', 'subcontract_order')
      .eq('reference_id', order.id)
      .eq('movement_type', 'subcontract_in')
      .single();
    expect(movement.direction).toBe('in');
    expect(Number(movement.quantity)).toBe(8);
    expect(Number(movement.unit_cost)).toBe(17.5);

    // Test 8: a real cost layer was created for the returned output at that same cost.
    const { data: layers } = await supabase
      .from('cost_layers')
      .select('quantity_remaining, unit_cost')
      .eq('tenant_id', TEST_TENANT_ID)
      .eq('item_id', output);
    expect(layers.length).toBe(1);
    expect(Number(layers[0].quantity_remaining)).toBe(8);
    expect(Number(layers[0].unit_cost)).toBe(17.5);

    // Adding a cost after receipt is rejected — the allocation already ran.
    await expect(
      subcontractOrdersService.addCost(order.id, TEST_TENANT_ID, null, {
        cost_type: 'other',
        amount: 5,
      } as any),
    ).rejects.toThrow('must be added before the order is received');
  }, 30_000);

  it('Test 9: a subcontract order can optionally link to a production order, without affecting its own completion', async () => {
    const subcontractor: any = await suppliersService.create(TEST_TENANT_ID, {
      name: 'Regr 13.16C Sub PO Link',
      is_subcontractor: true,
    });
    supplierIds.push(subcontractor.id);
    const component = await createItem('Regr 13.16C Component POLink');
    const finished = await createItem('Regr 13.16C Finished POLink');
    const material = await createItem('Regr 13.16C Material POLink');
    const output = await createItem('Regr 13.16C Output POLink');
    await seedStock(component, 50, 3);
    await seedStock(material, 10, 6);

    const { data: bom, error: bomErr } = await supabase
      .from('bill_of_materials')
      .insert({ tenant_id: TEST_TENANT_ID, item_id: finished, is_active: true })
      .select()
      .single();
    if (bomErr) throw bomErr;
    bomIds.push(bom.id);
    await supabase.from('bom_lines').insert({
      tenant_id: TEST_TENANT_ID,
      bom_id: bom.id,
      component_item_id: component,
      quantity_per_unit: 1,
      scrap_percentage: 0,
    });

    const { data: prodOrder, error: poErr } = await supabase
      .from('production_orders')
      .insert({
        tenant_id: TEST_TENANT_ID,
        warehouse_id: warehouseId,
        bom_id: bom.id,
        order_number: `MFG1316C-PO-${Date.now()}`,
        quantity_planned: 5,
        status: 'in_progress',
        started_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (poErr) throw poErr;
    productionOrderIds.push(prodOrder.id);

    const order: any = await subcontractOrdersService.create(
      TEST_TENANT_ID,
      null,
      {
        supplier_id: subcontractor.id,
        warehouse_id: warehouseId,
        production_order_id: prodOrder.id,
        order_number: `MFG1316C-LINKED-${Date.now()}`,
        lines: [
          {
            material_item_id: material,
            quantity_sent: 2,
            output_item_id: output,
            output_quantity: 2,
          },
        ],
      },
    );
    orderIds.push(order.id);
    expect(order.production_order_id).toBe(prodOrder.id);

    // Production order completion is untouched by subcontracting — it must
    // still complete normally with the subcontract order left at 'draft'.
    const { data: completed, error: completeErr } = await supabase.rpc(
      'fn_post_production_order',
      {
        p_production_order_id: prodOrder.id,
        p_actor_id: null,
      },
    );
    expect(completeErr).toBeNull();
    expect(completed.status).toBe('completed');

    const { data: subOrderAfter } = await supabase
      .from('subcontract_orders')
      .select('status')
      .eq('id', order.id)
      .single();
    expect(subOrderAfter.status).toBe('draft'); // unaffected by production completion
  }, 30_000);

  it('Test 10: tenant isolation — subcontract orders and lines are not visible cross-tenant', async () => {
    const subcontractor: any = await suppliersService.create(TEST_TENANT_ID, {
      name: 'Regr 13.16C Sub Isolation',
      is_subcontractor: true,
    });
    supplierIds.push(subcontractor.id);
    const material = await createItem('Regr 13.16C Material Iso');
    const output = await createItem('Regr 13.16C Output Iso');
    await seedStock(material, 10, 1);

    const order: any = await subcontractOrdersService.create(
      TEST_TENANT_ID,
      null,
      {
        supplier_id: subcontractor.id,
        warehouse_id: warehouseId,
        order_number: `MFG1316C-ISO-${Date.now()}`,
        lines: [
          {
            material_item_id: material,
            quantity_sent: 1,
            output_item_id: output,
            output_quantity: 1,
          },
        ],
      },
    );
    orderIds.push(order.id);

    await expect(
      subcontractOrdersService.findById(order.id, OTHER_TENANT_ID),
    ).rejects.toThrow('Subcontract order not found');
    const crossTenantList =
      await subcontractOrdersService.findAll(OTHER_TENANT_ID);
    expect(crossTenantList.some((o: any) => o.id === order.id)).toBe(false);
  }, 20_000);
});
