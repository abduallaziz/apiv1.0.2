/**
 * Regression suite for Migration 11.1b (Inventory Snapshots, #21). Runs
 * directly against the real shared Supabase project via the service-role
 * client — same approach as every other regression spec in this directory.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const TEST_TENANT_ID = '9bcd3369-d664-47c8-b297-3bc9b429aacf'; // Sefay Demo

describe('inventory snapshots regression (Migration 11.1b)', () => {
  let supabase: SupabaseClient;
  let warehouseId: string;
  let warehouseId2: string;
  const itemIds: string[] = [];
  const grIds: string[] = [];
  const runIds: string[] = [];
  const extraWarehouseIds: string[] = [];

  const createItem = async (name: string) => {
    const { data, error } = await supabase
      .from('items')
      .insert({ tenant_id: TEST_TENANT_ID, name, type: 'product', operation_type: 'sell', price: 10, is_active: true })
      .select()
      .single();
    if (error) throw error;
    itemIds.push(data.id);
    return data.id;
  };

  const seedStock = async (warehouseIdToUse: string, itemId: string, qty: number, unitCost: number) => {
    const { data: gr, error: grErr } = await supabase
      .from('goods_receipts')
      .insert({
        tenant_id: TEST_TENANT_ID,
        warehouse_id: warehouseIdToUse,
        receipt_number: `SNAP11-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        status: 'draft',
      })
      .select()
      .single();
    if (grErr) throw grErr;
    grIds.push(gr.id);

    const { error: lineErr } = await supabase.from('goods_receipt_items').insert({
      tenant_id: TEST_TENANT_ID,
      goods_receipt_id: gr.id,
      item_id: itemId,
      quantity_received: qty,
      unit_cost: unitCost,
    });
    if (lineErr) throw lineErr;

    const { error: postErr } = await supabase.rpc('fn_post_goods_receipt_with_ownership', {
      p_goods_receipt_id: gr.id,
      p_actor_id: null,
    });
    if (postErr) throw postErr;
  };

  beforeAll(async () => {
    supabase = createClient(process.env.SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string);
    const { data: wh, error } = await supabase.from('warehouses').select('id, branch_id').eq('tenant_id', TEST_TENANT_ID).limit(1);
    if (error) throw error;
    warehouseId = wh![0].id;

    const { data: wh2, error: wh2Err } = await supabase
      .from('warehouses')
      .insert({ tenant_id: TEST_TENANT_ID, branch_id: wh![0].branch_id, name: `SNAP11 WH2 ${Date.now()}`, code: `SNAP2${Date.now() % 100000}` })
      .select()
      .single();
    if (wh2Err) throw wh2Err;
    warehouseId2 = wh2.id;
    extraWarehouseIds.push(wh2.id);
  }, 30_000);

  afterAll(async () => {
    for (const id of runIds) {
      await supabase.from('inventory_snapshot_items').delete().eq('snapshot_run_id', id);
      await supabase.from('inventory_snapshot_runs').delete().eq('id', id);
    }
    for (const itemId of itemIds) {
      await supabase.from('cost_layers').delete().eq('item_id', itemId);
      await supabase.from('stock_levels').delete().eq('item_id', itemId);
    }
    for (const id of grIds) {
      await supabase.from('goods_receipt_items').delete().eq('goods_receipt_id', id);
      await supabase.from('goods_receipts').delete().eq('id', id);
    }
    for (const itemId of itemIds) {
      const { error } = await supabase.from('items').delete().eq('id', itemId);
      if (error) {
        await supabase.from('items').update({ is_active: false, deleted_at: new Date().toISOString() }).eq('id', itemId);
      }
    }
    for (const id of extraWarehouseIds) {
      const { error } = await supabase.from('warehouses').delete().eq('id', id);
      if (error) {
        await supabase.from('warehouses').update({ deleted_at: new Date().toISOString(), is_active: false }).eq('id', id);
      }
    }
  }, 60_000);

  it('Test 1: snapshot creation — one run created, correct item rows and quantities', async () => {
    const itemId = await createItem('SNAP11 Item A');
    await seedStock(warehouseId, itemId, 40, 5); // 40 @ 5 = 200

    const snapshotDate = `2026-01-15`; // arbitrary distinct date, avoids colliding with other tests' "today"
    const { data: run, error } = await supabase.rpc('fn_generate_inventory_snapshot', {
      p_tenant_id: TEST_TENANT_ID,
      p_actor_id: null,
      p_snapshot_date: snapshotDate,
      p_supersede: false,
    });
    expect(error).toBeNull();
    expect(run.status).toBe('active');
    runIds.push(run.id);

    const { data: items, error: itemsErr } = await supabase
      .from('inventory_snapshot_items')
      .select('*')
      .eq('snapshot_run_id', run.id)
      .eq('item_id', itemId);
    expect(itemsErr).toBeNull();
    expect(items!.length).toBe(1);
    expect(Number(items![0].quantity_on_hand)).toBe(40);
    expect(Number(items![0].average_unit_cost)).toBe(5);
    expect(Number(items![0].inventory_value)).toBe(200);
  }, 30_000);

  it('Test 2: valuation correctness — matches fn_inventory_valuation_report exactly', async () => {
    const itemId = await createItem('SNAP11 Item B (valuation check)');
    await seedStock(warehouseId, itemId, 12, 3.5); // 12 @ 3.5 = 42
    await seedStock(warehouseId, itemId, 8, 6); // +8 @ 6 = 48 -> total 20 units, 90 value, avg 4.5

    const { data: valuationReport, error: valErr } = await supabase.rpc('fn_inventory_valuation_report', {
      p_tenant_id: TEST_TENANT_ID,
      p_warehouse_id: warehouseId,
    });
    expect(valErr).toBeNull();
    const valRow = (valuationReport as any[]).find((r) => r.item_id === itemId);

    const { data: run, error } = await supabase.rpc('fn_generate_inventory_snapshot', {
      p_tenant_id: TEST_TENANT_ID,
      p_actor_id: null,
      p_snapshot_date: '2026-01-16',
      p_supersede: false,
    });
    expect(error).toBeNull();
    runIds.push(run.id);

    const { data: snapItems } = await supabase
      .from('inventory_snapshot_items')
      .select('*')
      .eq('snapshot_run_id', run.id)
      .eq('item_id', itemId)
      .eq('warehouse_id', warehouseId)
      .single();

    expect(Number(snapItems!.quantity_on_hand)).toBe(Number(valRow.quantity_on_hand));
    expect(Number(snapItems!.average_unit_cost)).toBe(Number(valRow.average_unit_cost));
    expect(Number(snapItems!.inventory_value)).toBe(Number(valRow.total_value));
    expect(Number(snapItems!.inventory_value)).toBe(90); // exact, known value
  }, 30_000);

  it('Test 3: multiple warehouses/items captured in one snapshot', async () => {
    const itemC = await createItem('SNAP11 Item C (multi-warehouse)');
    const itemD = await createItem('SNAP11 Item D (multi-warehouse)');
    await seedStock(warehouseId, itemC, 10, 2);
    await seedStock(warehouseId2, itemC, 15, 2);
    await seedStock(warehouseId, itemD, 5, 9);

    const { data: run, error } = await supabase.rpc('fn_generate_inventory_snapshot', {
      p_tenant_id: TEST_TENANT_ID,
      p_actor_id: null,
      p_snapshot_date: '2026-01-17',
      p_supersede: false,
    });
    expect(error).toBeNull();
    runIds.push(run.id);

    const { data: items } = await supabase
      .from('inventory_snapshot_items')
      .select('*')
      .eq('snapshot_run_id', run.id)
      .in('item_id', [itemC, itemD]);

    const itemCWh1 = items!.find((i: any) => i.item_id === itemC && i.warehouse_id === warehouseId);
    const itemCWh2 = items!.find((i: any) => i.item_id === itemC && i.warehouse_id === warehouseId2);
    const itemDWh1 = items!.find((i: any) => i.item_id === itemD && i.warehouse_id === warehouseId);

    expect(Number(itemCWh1!.quantity_on_hand)).toBe(10);
    expect(Number(itemCWh2!.quantity_on_hand)).toBe(15);
    expect(Number(itemDWh1!.quantity_on_hand)).toBe(5);
  }, 30_000);

  it('Test 4: tenant isolation — snapshot rows are scoped to tenant_id via RLS-equivalent explicit filter', async () => {
    const itemId = await createItem('SNAP11 Item E (tenant isolation)');
    await seedStock(warehouseId, itemId, 7, 1);

    const { data: run, error } = await supabase.rpc('fn_generate_inventory_snapshot', {
      p_tenant_id: TEST_TENANT_ID,
      p_actor_id: null,
      p_snapshot_date: '2026-01-18',
      p_supersede: false,
    });
    expect(error).toBeNull();
    runIds.push(run.id);
    expect(run.tenant_id).toBe(TEST_TENANT_ID);

    const { data: items } = await supabase.from('inventory_snapshot_items').select('tenant_id').eq('snapshot_run_id', run.id);
    for (const item of items!) {
      expect(item.tenant_id).toBe(TEST_TENANT_ID);
    }

    // A query for a different (bogus) tenant_id must return nothing for this run.
    const { data: crossTenant } = await supabase
      .from('inventory_snapshot_runs')
      .select('id')
      .eq('id', run.id)
      .eq('tenant_id', '00000000-0000-0000-0000-000000000000');
    expect(crossTenant!.length).toBe(0);
  }, 30_000);

  it('Test 5: immutability — duplicate generation rejected, supersede creates a new active run, old run retained unchanged', async () => {
    const itemId = await createItem('SNAP11 Item F (immutability)');
    await seedStock(warehouseId, itemId, 20, 4);
    const snapshotDate = '2026-01-19';

    const { data: firstRun, error: firstErr } = await supabase.rpc('fn_generate_inventory_snapshot', {
      p_tenant_id: TEST_TENANT_ID,
      p_actor_id: null,
      p_snapshot_date: snapshotDate,
      p_supersede: false,
    });
    expect(firstErr).toBeNull();
    runIds.push(firstRun.id);

    // Duplicate generation without supersede -> rejected.
    const { error: dupErr } = await supabase.rpc('fn_generate_inventory_snapshot', {
      p_tenant_id: TEST_TENANT_ID,
      p_actor_id: null,
      p_snapshot_date: snapshotDate,
      p_supersede: false,
    });
    expect(dupErr).not.toBeNull();

    // First run must be untouched by the rejected attempt.
    const { data: stillActive } = await supabase.from('inventory_snapshot_runs').select('status').eq('id', firstRun.id).single();
    expect(stillActive!.status).toBe('active');

    // Add more stock, then supersede -> new active run, old run flips to superseded, old items retained.
    await seedStock(warehouseId, itemId, 30, 4); // now 50 total
    const { data: secondRun, error: secondErr } = await supabase.rpc('fn_generate_inventory_snapshot', {
      p_tenant_id: TEST_TENANT_ID,
      p_actor_id: null,
      p_snapshot_date: snapshotDate,
      p_supersede: true,
    });
    expect(secondErr).toBeNull();
    runIds.push(secondRun.id);
    expect(secondRun.status).toBe('active');
    expect(secondRun.id).not.toBe(firstRun.id);

    const { data: firstRunAfter } = await supabase.from('inventory_snapshot_runs').select('status').eq('id', firstRun.id).single();
    expect(firstRunAfter!.status).toBe('superseded');

    // Old run's item rows are retained, unchanged (still reflect the 20-unit state).
    const { data: firstRunItems } = await supabase
      .from('inventory_snapshot_items')
      .select('quantity_on_hand')
      .eq('snapshot_run_id', firstRun.id)
      .eq('item_id', itemId)
      .single();
    expect(Number(firstRunItems!.quantity_on_hand)).toBe(20);

    // New run reflects the updated 50-unit state.
    const { data: secondRunItems } = await supabase
      .from('inventory_snapshot_items')
      .select('quantity_on_hand')
      .eq('snapshot_run_id', secondRun.id)
      .eq('item_id', itemId)
      .single();
    expect(Number(secondRunItems!.quantity_on_hand)).toBe(50);

    // Only one ACTIVE run exists for this date.
    const { data: activeRuns } = await supabase
      .from('inventory_snapshot_runs')
      .select('id')
      .eq('tenant_id', TEST_TENANT_ID)
      .eq('snapshot_date', snapshotDate)
      .eq('status', 'active');
    expect(activeRuns!.length).toBe(1);
    expect(activeRuns![0].id).toBe(secondRun.id);
  }, 30_000);
});
