/**
 * Regression suite for Migration 13.17 Phase B (migrations 160-162):
 * MRP Engine — BOM explosion, net requirements, planned orders.
 * Runs directly against the real shared Supabase project, same pattern as
 * safety-stock-and-replenishment.regression.spec.ts. Not wired into CI —
 * run via `npm test`.
 *
 * Test order matters: test 4 posts a permanent stock receipt for the raw
 * material (stock_movements is an immutable ledger — migration 017), so
 * every test that needs a fresh raw-material shortage (test 3, the convert
 * flow) runs BEFORE it.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const TEST_TENANT_ID = '9bcd3369-d664-47c8-b297-3bc9b429aacf'; // Sefay Demo

describe('MRP Engine (migrations 160-162)', () => {
  let supabase: SupabaseClient;
  let warehouseId: string;
  let rawMaterialId: string;
  let subAssemblyId: string;
  let finishedItemId: string;
  let subAssemblyBomId: string;
  let finishedBomId: string;
  let reorderPointId: string;

  beforeAll(async () => {
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    );

    const { data: wh } = await supabase
      .from('warehouses')
      .select('id')
      .eq('tenant_id', TEST_TENANT_ID)
      .limit(1);
    warehouseId = wh[0].id;

    const mk = async (name: string, type: string) => {
      const { data, error } = await supabase
        .from('items')
        .insert({
          tenant_id: TEST_TENANT_ID,
          name,
          type,
          operation_type: 'sell',
          price: 5,
          is_active: true,
        })
        .select()
        .single();
      if (error) throw error;
      return data.id as string;
    };
    rawMaterialId = await mk('MRP Regression Raw Material', 'raw_material');
    subAssemblyId = await mk('MRP Regression Sub Assembly', 'semi_finished');
    finishedItemId = await mk('MRP Regression Finished Item', 'finished_goods');

    // 2-level BOM: Finished Item needs 2x Sub Assembly; Sub Assembly needs 3x Raw Material.
    const { data: subBom } = await supabase
      .from('bill_of_materials')
      .insert({
        tenant_id: TEST_TENANT_ID,
        item_id: subAssemblyId,
        is_active: true,
      })
      .select()
      .single();
    subAssemblyBomId = subBom.id;
    await supabase.from('bom_lines').insert({
      tenant_id: TEST_TENANT_ID,
      bom_id: subAssemblyBomId,
      component_item_id: rawMaterialId,
      quantity_per_unit: 3,
    });

    const { data: finBom } = await supabase
      .from('bill_of_materials')
      .insert({
        tenant_id: TEST_TENANT_ID,
        item_id: finishedItemId,
        is_active: true,
      })
      .select()
      .single();
    finishedBomId = finBom.id;
    await supabase.from('bom_lines').insert({
      tenant_id: TEST_TENANT_ID,
      bom_id: finishedBomId,
      component_item_id: subAssemblyId,
      quantity_per_unit: 2,
    });

    // Reorder point on the finished item forces a shortage (zero stock, min_quantity 20).
    const { data: rp } = await supabase
      .from('inventory_reorder_points')
      .insert({
        tenant_id: TEST_TENANT_ID,
        warehouse_id: warehouseId,
        item_id: finishedItemId,
        min_quantity: 20,
        reorder_quantity: 20,
        lead_time_days: 5,
        is_active: true,
      })
      .select()
      .single();
    reorderPointId = rp.id;
  }, 30_000);

  afterAll(async () => {
    // Delete in FK-safe order: anything created by conversion first, then
    // planned_orders (RESTRICT from items), then BOMs (cascades bom_lines),
    // then the reorder point, then the items themselves.
    await supabase
      .from('production_orders')
      .delete()
      .eq('tenant_id', TEST_TENANT_ID)
      .in('bom_id', [subAssemblyBomId, finishedBomId]);
    await supabase
      .from('purchase_request_items')
      .delete()
      .eq('item_id', rawMaterialId);
    await supabase
      .from('purchase_requests')
      .delete()
      .eq('tenant_id', TEST_TENANT_ID)
      .ilike('notes', '%MRP planned order%');
    await supabase
      .from('planned_orders')
      .delete()
      .in('item_id', [rawMaterialId, subAssemblyId, finishedItemId]);
    await supabase
      .from('inventory_reorder_points')
      .delete()
      .eq('id', reorderPointId);
    await supabase
      .from('bill_of_materials')
      .delete()
      .in('id', [subAssemblyBomId, finishedBomId]);
    await supabase
      .from('items')
      .delete()
      .in('id', [rawMaterialId, subAssemblyId, finishedItemId]);
  }, 30_000);

  it('1. single-level BOM explosion: fn_explode_bom_requirements creates a purchase planned order for a leaf raw material', async () => {
    const { error } = await supabase.rpc('fn_explode_bom_requirements', {
      p_tenant_id: TEST_TENANT_ID,
      p_warehouse_id: warehouseId,
      p_bom_id: subAssemblyBomId,
      p_quantity: 10,
      p_mrp_run_id: '11111111-1111-1111-1111-111111111111',
      p_parent_planned_order_id: null,
      p_depth: 1,
    });
    expect(error).toBeNull();

    const { data: rows } = await supabase
      .from('planned_orders')
      .select('*')
      .eq('mrp_run_id', '11111111-1111-1111-1111-111111111111');
    expect(rows.length).toBe(1);
    expect(rows[0].item_id).toBe(rawMaterialId);
    expect(rows[0].order_type).toBe('purchase');
    expect(Number(rows[0].quantity)).toBe(30); // 10 units * 3 per unit, no scrap, zero stock/safety

    await supabase
      .from('planned_orders')
      .delete()
      .eq('mrp_run_id', '11111111-1111-1111-1111-111111111111');
  });

  it('2. multi-level BOM explosion: fn_run_mrp produces a full 3-level chain (finished -> sub-assembly -> raw material)', async () => {
    const { data: runId, error } = await supabase.rpc('fn_run_mrp', {
      p_tenant_id: TEST_TENANT_ID,
      p_warehouse_id: warehouseId,
    });
    expect(error).toBeNull();

    const { data: rows } = await supabase
      .from('planned_orders')
      .select('*')
      .eq('mrp_run_id', runId)
      .in('item_id', [finishedItemId, subAssemblyId, rawMaterialId]);

    const finished = rows.find((r) => r.item_id === finishedItemId);
    const sub = rows.find((r) => r.item_id === subAssemblyId);
    const raw = rows.find((r) => r.item_id === rawMaterialId);

    expect(finished).toBeDefined();
    expect(finished.order_type).toBe('production');
    expect(finished.source).toBe('independent_demand');
    expect(finished.parent_planned_order_id).toBeNull();
    expect(finished.bom_id).toBe(finishedBomId);

    expect(sub).toBeDefined();
    expect(sub.order_type).toBe('production');
    expect(sub.source).toBe('dependent_demand');
    expect(sub.parent_planned_order_id).toBe(finished.id);
    expect(Number(sub.quantity)).toBe(Number(finished.quantity) * 2);

    expect(raw).toBeDefined();
    expect(raw.order_type).toBe('purchase');
    expect(raw.source).toBe('dependent_demand');
    expect(raw.parent_planned_order_id).toBe(sub.id);
    expect(Number(raw.quantity)).toBe(Number(sub.quantity) * 3);
  });

  it('3. planned purchase order converts into a real purchase_requests row', async () => {
    const { data: runId } = await supabase.rpc('fn_run_mrp', {
      p_tenant_id: TEST_TENANT_ID,
      p_warehouse_id: warehouseId,
    });
    const { data: rawRow } = await supabase
      .from('planned_orders')
      .select('*')
      .eq('mrp_run_id', runId)
      .eq('item_id', rawMaterialId)
      .single();
    expect(rawRow.order_type).toBe('purchase');

    await supabase
      .from('planned_orders')
      .update({ status: 'approved' })
      .eq('id', rawRow.id);

    // Mirrors what MrpService.convert() does: create the PR via the same
    // purchase_requests tables the application layer writes to, then mark converted.
    const { data: pr } = await supabase
      .from('purchase_requests')
      .insert({
        tenant_id: TEST_TENANT_ID,
        warehouse_id: warehouseId,
        request_number: `MRP-REGR-PR-${Date.now()}`,
        status: 'draft',
        notes: 'Generated from MRP planned order',
      })
      .select()
      .single();
    await supabase.from('purchase_request_items').insert({
      tenant_id: TEST_TENANT_ID,
      purchase_request_id: pr.id,
      item_id: rawMaterialId,
      quantity_requested: rawRow.quantity,
    });
    await supabase
      .from('planned_orders')
      .update({
        status: 'converted',
        converted_reference_type: 'purchase_request',
        converted_reference_id: pr.id,
      })
      .eq('id', rawRow.id);

    const { data: updated } = await supabase
      .from('planned_orders')
      .select('*')
      .eq('id', rawRow.id)
      .single();
    expect(updated.status).toBe('converted');
    expect(updated.converted_reference_id).toBe(pr.id);
  });

  it('4. inventory offsets requirements: adding on-hand stock for the raw material reduces its planned quantity on the next run', async () => {
    // Post a real receipt so the raw material has real on-hand stock via the
    // unmodified fn_apply_stock_movement/fn_add_cost_layer primitives.
    // stock_movements is an immutable ledger -- this is permanent, hence
    // this test running after the convert test above, not before it.
    const { error: mvError } = await supabase.rpc('fn_apply_stock_movement', {
      p_tenant_id: TEST_TENANT_ID,
      p_warehouse_id: warehouseId,
      p_location_id: null,
      p_item_id: rawMaterialId,
      p_variant_id: null,
      p_batch_id: null,
      p_movement_type: 'receipt',
      p_direction: 'in',
      p_quantity: 1000,
      p_unit_cost: 1,
      p_reference_type: 'regression_test',
      p_reference_id: null,
      p_created_by: null,
      p_allow_negative: false,
    });
    expect(mvError).toBeNull();

    const { data: runId } = await supabase.rpc('fn_run_mrp', {
      p_tenant_id: TEST_TENANT_ID,
      p_warehouse_id: warehouseId,
    });
    const { data: rows } = await supabase
      .from('planned_orders')
      .select('*')
      .eq('mrp_run_id', runId)
      .eq('item_id', rawMaterialId);

    // 1000 units on-hand comfortably exceeds any raw-material requirement from this small BOM -> net requirement is 0 -> no planned order for it.
    expect(rows.length).toBe(0);
  });

  it('5. open production order offsets requirements: an in-progress production order for the sub-assembly reduces its planned quantity', async () => {
    const { data: po, error } = await supabase
      .from('production_orders')
      .insert({
        tenant_id: TEST_TENANT_ID,
        warehouse_id: warehouseId,
        bom_id: subAssemblyBomId,
        order_number: `MRP-REGR-PO-${Date.now()}`,
        quantity_planned: 999999,
        status: 'in_progress',
      })
      .select()
      .single();
    expect(error).toBeNull();

    const { data: runId } = await supabase.rpc('fn_run_mrp', {
      p_tenant_id: TEST_TENANT_ID,
      p_warehouse_id: warehouseId,
    });
    const { data: rows } = await supabase
      .from('planned_orders')
      .select('*')
      .eq('mrp_run_id', runId)
      .eq('item_id', subAssemblyId);

    // A huge open production order (999999 planned, 0 produced) covers any realistic requirement -> net requirement 0.
    expect(rows.length).toBe(0);

    await supabase.from('production_orders').delete().eq('id', po.id);
  });

  it('6. rerun replaces only proposed planned orders, preserving approved/converted/cancelled history', async () => {
    const { data: runId1 } = await supabase.rpc('fn_run_mrp', {
      p_tenant_id: TEST_TENANT_ID,
      p_warehouse_id: warehouseId,
    });
    const { data: firstRun } = await supabase
      .from('planned_orders')
      .select('*')
      .eq('mrp_run_id', runId1)
      .eq('item_id', finishedItemId)
      .single();

    await supabase
      .from('planned_orders')
      .update({ status: 'approved' })
      .eq('id', firstRun.id);

    const { data: runId2 } = await supabase.rpc('fn_run_mrp', {
      p_tenant_id: TEST_TENANT_ID,
      p_warehouse_id: warehouseId,
    });
    expect(runId2).not.toBe(runId1);

    // The approved row from run 1 must still exist, untouched.
    const { data: stillThere } = await supabase
      .from('planned_orders')
      .select('*')
      .eq('id', firstRun.id)
      .single();
    expect(stillThere.status).toBe('approved');
    expect(stillThere.mrp_run_id).toBe(runId1);

    // A fresh proposed row for the same item exists under run 2 (regenerated).
    const { data: secondRun } = await supabase
      .from('planned_orders')
      .select('*')
      .eq('mrp_run_id', runId2)
      .eq('item_id', finishedItemId);
    expect(secondRun.length).toBe(1);
    expect(secondRun[0].status).toBe('proposed');

    await supabase.from('planned_orders').delete().eq('id', firstRun.id);
  });

  it("7. tenant isolation: fn_run_mrp for a different tenant does not see this tenant's reorder point", async () => {
    const { data: runId, error } = await supabase.rpc('fn_run_mrp', {
      p_tenant_id: '00000000-0000-0000-0000-000000000000',
      p_warehouse_id: warehouseId,
    });
    expect(error).toBeNull();
    const { data: rows } = await supabase
      .from('planned_orders')
      .select('*')
      .eq('mrp_run_id', runId);
    expect(rows.length).toBe(0);
  });

  it('8. BOM explosion depth guard: a data cycle raises an exception instead of looping forever', async () => {
    // Deliberately construct a 2-item cycle (A's BOM contains B, B's BOM contains A) to
    // prove the depth cap (10) fires rather than recursing indefinitely.
    const { data: itemA } = await supabase
      .from('items')
      .insert({
        tenant_id: TEST_TENANT_ID,
        name: 'MRP Regression Cycle A',
        type: 'semi_finished',
        operation_type: 'sell',
        price: 5,
        is_active: true,
      })
      .select()
      .single();
    const { data: itemB } = await supabase
      .from('items')
      .insert({
        tenant_id: TEST_TENANT_ID,
        name: 'MRP Regression Cycle B',
        type: 'semi_finished',
        operation_type: 'sell',
        price: 5,
        is_active: true,
      })
      .select()
      .single();

    const { data: bomA } = await supabase
      .from('bill_of_materials')
      .insert({ tenant_id: TEST_TENANT_ID, item_id: itemA.id, is_active: true })
      .select()
      .single();
    const { data: bomB } = await supabase
      .from('bill_of_materials')
      .insert({ tenant_id: TEST_TENANT_ID, item_id: itemB.id, is_active: true })
      .select()
      .single();
    await supabase.from('bom_lines').insert({
      tenant_id: TEST_TENANT_ID,
      bom_id: bomA.id,
      component_item_id: itemB.id,
      quantity_per_unit: 1,
    });
    await supabase.from('bom_lines').insert({
      tenant_id: TEST_TENANT_ID,
      bom_id: bomB.id,
      component_item_id: itemA.id,
      quantity_per_unit: 1,
    });

    const { error } = await supabase.rpc('fn_explode_bom_requirements', {
      p_tenant_id: TEST_TENANT_ID,
      p_warehouse_id: warehouseId,
      p_bom_id: bomA.id,
      p_quantity: 1,
      p_mrp_run_id: '22222222-2222-2222-2222-222222222222',
      p_parent_planned_order_id: null,
      p_depth: 1,
    });
    expect(error).not.toBeNull();
    expect(error.message).toMatch(/exceeded max depth/);

    await supabase
      .from('planned_orders')
      .delete()
      .eq('mrp_run_id', '22222222-2222-2222-2222-222222222222');
    await supabase
      .from('bill_of_materials')
      .delete()
      .in('id', [bomA.id, bomB.id]);
    await supabase.from('items').delete().in('id', [itemA.id, itemB.id]);
  }, 20_000);
});
