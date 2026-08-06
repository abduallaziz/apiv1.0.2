/**
 * Regression suite for Migration 6.7 (Production Orders read model). Runs
 * directly against the real shared Supabase project via the service-role
 * client — same approach as transfer-lifecycle.regression.spec.ts and
 * manufacturing-locations.regression.spec.ts, there is no isolated test
 * database in this environment.
 *
 * Exists to prove two things the migration's design depends on:
 * (1) the FK-embed select strings used by ProductionOrdersRepository
 *     (LIST_SELECT/DETAIL_SELECT) actually resolve against the live schema —
 *     the `!<fk_constraint>` names were inferred from Postgres's default
 *     naming convention, not read from information_schema, so this is the
 *     one part of the migration that could silently be wrong;
 * (2) the underlying fn_post_production_order workflow (create draft ->
 *     complete) still behaves correctly through the new read-model queries,
 *     including the INSUFFICIENT_STOCK failure path.
 *
 * Not wired into CI — run deliberately via `npm test` when touching this
 * area again.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const TEST_TENANT_ID = '9bcd3369-d664-47c8-b297-3bc9b429aacf'; // Sefay Demo

const LIST_SELECT = `*,
    warehouse:warehouses!production_orders_warehouse_id_fkey(name, code),
    bom:bill_of_materials!production_orders_bom_id_fkey(
      item:items!bill_of_materials_item_id_fkey(name, sku)
    )`;

const DETAIL_SELECT = `*,
    warehouse:warehouses!production_orders_warehouse_id_fkey(name, code),
    work_center:work_centers!production_orders_work_center_id_fkey(name, is_active),
    created_by_user:users!production_orders_created_by_fkey(name, email)`;

describe('production orders read model regression (Migration 6.7)', () => {
  let supabase: SupabaseClient;
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

  const seedStock = async (componentItemId: string, qty: number, unitCost: number) => {
    const { data: gr, error: grErr } = await supabase
      .from('goods_receipts')
      .insert({
        tenant_id: TEST_TENANT_ID,
        warehouse_id: warehouseId,
        receipt_number: `PO67-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        status: 'draft',
      })
      .select()
      .single();
    if (grErr) throw grErr;
    grIds.push(gr.id);

    const { error: lineErr } = await supabase.from('goods_receipt_items').insert({
      tenant_id: TEST_TENANT_ID,
      goods_receipt_id: gr.id,
      item_id: componentItemId,
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

  const createBom = async (finishedItemId: string, componentItemId: string, qtyPerUnit: number) => {
    const { data: bom, error: bomErr } = await supabase
      .from('bill_of_materials')
      .insert({ tenant_id: TEST_TENANT_ID, item_id: finishedItemId, is_active: true })
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

  const createOrder = async (bomId: string, quantityPlanned: number) => {
    const { data, error } = await supabase
      .from('production_orders')
      .insert({
        tenant_id: TEST_TENANT_ID,
        warehouse_id: warehouseId,
        bom_id: bomId,
        order_number: `PO67-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        quantity_planned: quantityPlanned,
        status: 'draft',
      })
      .select()
      .single();
    if (error) throw error;
    orderIds.push(data.id);
    return data.id;
  };

  beforeAll(async () => {
    supabase = createClient(process.env.SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string);
    const { data: wh, error } = await supabase.from('warehouses').select('id').eq('tenant_id', TEST_TENANT_ID).limit(1);
    if (error) throw error;
    warehouseId = wh![0].id;
  }, 30_000);

  afterAll(async () => {
    for (const id of orderIds) await supabase.from('production_orders').delete().eq('id', id);
    for (const id of bomIds) {
      await supabase.from('bom_lines').delete().eq('bom_id', id);
      await supabase.from('bill_of_materials').delete().eq('id', id);
    }
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

  it('LIST_SELECT embed resolves warehouse name and BOM output item name (validates FK constraint names)', async () => {
    const componentId = await createItem('PO67 Component (list embed)');
    const finishedId = await createItem('PO67 Finished (list embed)');
    await seedStock(componentId, 50, 2);
    const bomId = await createBom(finishedId, componentId, 2);
    const orderId = await createOrder(bomId, 5);

    const { data, error } = await supabase
      .from('production_orders')
      .select(LIST_SELECT)
      .eq('id', orderId)
      .eq('tenant_id', TEST_TENANT_ID)
      .single();

    expect(error).toBeNull();
    expect((data as any).warehouse?.name).toBeTruthy();
    expect((data as any).bom?.item?.name).toBe('PO67 Finished (list embed)');
  }, 30_000);

  it('DETAIL_SELECT embed resolves (work_center/created_by are null-safe when unset)', async () => {
    const componentId = await createItem('PO67 Component (detail embed)');
    const finishedId = await createItem('PO67 Finished (detail embed)');
    await seedStock(componentId, 50, 2);
    const bomId = await createBom(finishedId, componentId, 2);
    const orderId = await createOrder(bomId, 5);

    const { data, error } = await supabase
      .from('production_orders')
      .select(DETAIL_SELECT)
      .eq('id', orderId)
      .eq('tenant_id', TEST_TENANT_ID)
      .single();

    expect(error).toBeNull();
    expect((data as any).warehouse?.name).toBeTruthy();
    expect((data as any).work_center).toBeNull(); // no work_center_id set on this order
    expect((data as any).created_by_user).toBeNull(); // no created_by set on this order
  }, 30_000);

  it('draft -> completed (direct) works; consumption movements queryable afterward', async () => {
    const componentId = await createItem('PO67 Component (happy path)');
    const finishedId = await createItem('PO67 Finished (happy path)');
    await seedStock(componentId, 100, 3);
    const bomId = await createBom(finishedId, componentId, 4);
    const orderId = await createOrder(bomId, 5);

    const { data: completed, error: completeErr } = await supabase.rpc('fn_post_production_order', {
      p_production_order_id: orderId,
      p_actor_id: null,
    });
    expect(completeErr).toBeNull();
    expect(completed.status).toBe('completed');

    // findConsumptionMovements query (production-orders.repository.ts)
    const { data: movements, error: movErr } = await supabase
      .from('stock_movements')
      .select('item_id, quantity, movement_type')
      .eq('tenant_id', TEST_TENANT_ID)
      .eq('reference_type', 'production_order')
      .eq('reference_id', orderId)
      .eq('movement_type', 'production_consumption');
    expect(movErr).toBeNull();
    expect(movements!.length).toBe(1);
    expect(Number(movements![0].quantity)).toBe(20); // 4 per unit * 5 produced
  }, 30_000);

  // Migration 6.8 — fn_post_production_order's guard was widened to accept
  // 'draft' OR 'in_progress' (see 141_production_order_lifecycle_fix.sql),
  // fixing the bug documented in the Migration 6.7 report where start()
  // then complete() always failed with "is not draft".
  it('draft -> start -> complete succeeds (Migration 6.8 fix)', async () => {
    const componentId = await createItem('PO68 Component (start-then-complete)');
    const finishedId = await createItem('PO68 Finished (start-then-complete)');
    await seedStock(componentId, 100, 3);
    const bomId = await createBom(finishedId, componentId, 4);
    const orderId = await createOrder(bomId, 5);

    const { error: startErr } = await supabase
      .from('production_orders')
      .update({ status: 'in_progress', started_at: new Date().toISOString() })
      .eq('id', orderId)
      .eq('status', 'draft');
    expect(startErr).toBeNull();

    const { data: completed, error: completeErr } = await supabase.rpc('fn_post_production_order', {
      p_production_order_id: orderId,
      p_actor_id: null,
    });
    expect(completeErr).toBeNull();
    expect(completed.status).toBe('completed');
  }, 30_000);

  it('insufficient stock: completion fails and order stays draft (no partial mutation)', async () => {
    const componentId = await createItem('PO67 Component (insufficient stock)');
    const finishedId = await createItem('PO67 Finished (insufficient stock)');
    await seedStock(componentId, 5, 3); // only 5 on hand
    const bomId = await createBom(finishedId, componentId, 4); // needs 4/unit
    const orderId = await createOrder(bomId, 10); // needs 40, only 5 available

    const { error } = await supabase.rpc('fn_post_production_order', {
      p_production_order_id: orderId,
      p_actor_id: null,
    });
    expect(error).not.toBeNull();
    expect(error!.message).toContain('INSUFFICIENT');

    const { data: order } = await supabase.from('production_orders').select('status').eq('id', orderId).single();
    expect(order!.status).toBe('draft'); // unchanged — the whole RPC call was one failed transaction
  }, 30_000);

  it('cancel: draft order can be cancelled', async () => {
    const componentId = await createItem('PO67 Component (cancel)');
    const finishedId = await createItem('PO67 Finished (cancel)');
    await seedStock(componentId, 50, 2);
    const bomId = await createBom(finishedId, componentId, 2);
    const orderId = await createOrder(bomId, 5);

    const { data, error } = await supabase
      .from('production_orders')
      .update({ status: 'cancelled' })
      .eq('id', orderId)
      .eq('status', 'draft')
      .select()
      .maybeSingle();
    expect(error).toBeNull();
    expect(data!.status).toBe('cancelled');
  }, 30_000);

  // Migration 6.8 — cancel() now allows draft OR in_progress (mirrors
  // ProductionOrdersRepository.cancel()'s .in('status', ['draft','in_progress'])).
  // Fixes the gap flagged in the Migration 6.7 report.
  it('cancel: an in_progress order CAN now be cancelled (Migration 6.8 fix)', async () => {
    const componentId = await createItem('PO68 Component (in_progress cancel)');
    const finishedId = await createItem('PO68 Finished (in_progress cancel)');
    await seedStock(componentId, 50, 2);
    const bomId = await createBom(finishedId, componentId, 2);
    const orderId = await createOrder(bomId, 5);

    await supabase.from('production_orders').update({ status: 'in_progress' }).eq('id', orderId);

    const { data, error } = await supabase
      .from('production_orders')
      .update({ status: 'cancelled' })
      .eq('id', orderId)
      .in('status', ['draft', 'in_progress'])
      .select()
      .maybeSingle();
    expect(error).toBeNull();
    expect(data!.status).toBe('cancelled');
  }, 30_000);

  it('cancel: a completed order cannot be cancelled (guard still excludes completed/cancelled)', async () => {
    const componentId = await createItem('PO68 Component (completed cancel guard)');
    const finishedId = await createItem('PO68 Finished (completed cancel guard)');
    await seedStock(componentId, 50, 2);
    const bomId = await createBom(finishedId, componentId, 2);
    const orderId = await createOrder(bomId, 5);

    await supabase.rpc('fn_post_production_order', { p_production_order_id: orderId, p_actor_id: null });

    const { data } = await supabase
      .from('production_orders')
      .update({ status: 'cancelled' })
      .eq('id', orderId)
      .in('status', ['draft', 'in_progress'])
      .select()
      .maybeSingle();
    expect(data).toBeNull(); // 0 rows matched — completed is correctly excluded

    const { data: stillCompleted } = await supabase.from('production_orders').select('status').eq('id', orderId).single();
    expect(stillCompleted!.status).toBe('completed');
  }, 30_000);
});
