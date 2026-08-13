/**
 * Regression suite for item #9.4 (migration 127): unified vendor lead time.
 * Confirms fn_supplier_item_lead_time (item+supplier, item-only, and
 * supplier-only variants) and both its callers (fn_supplier_profile_stats,
 * fn_purchase_suggestions) agree on the same real historical value —
 * closing the discrepancy where two separate formulas previously existed.
 * Also confirms no lead time is ever stored on `suppliers` itself.
 * Runs directly against the real shared Supabase project (no isolated
 * test DB in this environment). Not wired into CI — run via `npm test`.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const TEST_TENANT_ID = '9bcd3369-d664-47c8-b297-3bc9b429aacf'; // Sefay Demo

describe('unified vendor lead time (migration 127)', () => {
  let supabase: SupabaseClient;
  let warehouseId: string;
  let supplierId: string;
  let itemId: string;
  const cleanup = { pos: [] as string[], grs: [] as string[] };

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

    const { data: supplier } = await supabase
      .from('suppliers')
      .insert({ tenant_id: TEST_TENANT_ID, name: 'Regression 9.4 Supplier' })
      .select()
      .single();
    supplierId = supplier.id;

    const { data: item } = await supabase
      .from('items')
      .insert({
        tenant_id: TEST_TENANT_ID,
        name: 'Regression 9.4 Item',
        type: 'product',
        operation_type: 'sell',
        price: 5,
        is_active: true,
      })
      .select()
      .single();
    itemId = item.id;

    // Two real receiving cycles with known, distinct lead times: 4 and 6 days -> avg 5.
    for (const [orderDate, receivedAt] of [
      ['2026-07-01', '2026-07-05T00:00:00Z'],
      ['2026-07-01', '2026-07-07T00:00:00Z'],
    ]) {
      const { data: po } = await supabase
        .from('purchase_orders')
        .insert({
          tenant_id: TEST_TENANT_ID,
          supplier_id: supplierId,
          warehouse_id: warehouseId,
          order_number: `REGR-94-PO-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          order_date: orderDate,
          status: 'draft',
        })
        .select()
        .single();
      cleanup.pos.push(po.id);
      const { data: poi } = await supabase
        .from('purchase_order_items')
        .insert({
          tenant_id: TEST_TENANT_ID,
          purchase_order_id: po.id,
          item_id: itemId,
          quantity_ordered: 10,
          unit_cost: 5,
        })
        .select()
        .single();

      const { data: gr } = await supabase
        .from('goods_receipts')
        .insert({
          tenant_id: TEST_TENANT_ID,
          purchase_order_id: po.id,
          warehouse_id: warehouseId,
          receipt_number: `REGR-94-GR-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          status: 'draft',
        })
        .select()
        .single();
      cleanup.grs.push(gr.id);
      await supabase.from('goods_receipt_items').insert({
        tenant_id: TEST_TENANT_ID,
        goods_receipt_id: gr.id,
        purchase_order_item_id: poi.id,
        item_id: itemId,
        quantity_received: 10,
        unit_cost: 5,
      });
      // Directly mark posted+received_at (bypassing fn_post_goods_receipt) --
      // this suite only exercises the lead-time READ formula, not posting
      // side effects (stock/cost layers), which are already covered by
      // other regression suites.
      await supabase
        .from('goods_receipts')
        .update({ status: 'posted', received_at: receivedAt })
        .eq('id', gr.id);
    }
  }, 30_000);

  afterAll(async () => {
    for (const grId of cleanup.grs) {
      await supabase
        .from('goods_receipt_items')
        .delete()
        .eq('goods_receipt_id', grId);
      await supabase.from('goods_receipts').delete().eq('id', grId);
    }
    for (const poId of cleanup.pos) {
      await supabase
        .from('purchase_order_items')
        .delete()
        .eq('purchase_order_id', poId);
      await supabase.from('purchase_orders').delete().eq('id', poId);
    }
    await supabase.from('items').delete().eq('id', itemId);
    await supabase.from('suppliers').delete().eq('id', supplierId);
  }, 30_000);

  it('computes the correct average lead time for (item, supplier)', async () => {
    const { data, error } = await supabase.rpc('fn_supplier_item_lead_time', {
      p_tenant_id: TEST_TENANT_ID,
      p_item_id: itemId,
      p_supplier_id: supplierId,
    });
    expect(error).toBeNull();
    expect(data).toBe(5);
  });

  it('computes the same value item-only (no supplier given)', async () => {
    const { data } = await supabase.rpc('fn_supplier_item_lead_time', {
      p_tenant_id: TEST_TENANT_ID,
      p_item_id: itemId,
      p_supplier_id: null,
    });
    expect(data).toBe(5);
  });

  it('computes the same value supplier-only (no item given)', async () => {
    const { data } = await supabase.rpc('fn_supplier_item_lead_time', {
      p_tenant_id: TEST_TENANT_ID,
      p_item_id: null,
      p_supplier_id: supplierId,
    });
    expect(data).toBe(5);
  });

  it('fn_supplier_profile_stats reports the same unified value', async () => {
    const { data, error } = await supabase.rpc('fn_supplier_profile_stats', {
      p_tenant_id: TEST_TENANT_ID,
      p_supplier_id: supplierId,
    });
    expect(error).toBeNull();
    expect(data[0].avg_lead_time_days).toBe(5);
  });

  it('fn_purchase_suggestions falls back to the same unified value when no lead_time_days is configured', async () => {
    const { data: rp } = await supabase
      .from('inventory_reorder_points')
      .insert({
        tenant_id: TEST_TENANT_ID,
        warehouse_id: warehouseId,
        item_id: itemId,
        min_quantity: 999999,
        reorder_quantity: 20,
        is_active: true,
      })
      .select()
      .single();

    const { data: suggestions, error } = await supabase.rpc(
      'fn_purchase_suggestions',
      { p_tenant_id: TEST_TENANT_ID },
    );
    expect(error).toBeNull();
    const mine = (suggestions as any[]).find(
      (s) => s.reorder_point_id === rp.id,
    );
    expect(mine.lead_time_days).toBe(5);

    await supabase.from('inventory_reorder_points').delete().eq('id', rp.id);
  });

  it('confirms no lead-time column exists on suppliers itself', async () => {
    const { data, error } = await supabase
      .from('suppliers')
      .select('*')
      .eq('id', supplierId)
      .single();
    expect(error).toBeNull();
    expect(Object.keys(data as object)).not.toContain('lead_time_days');
    expect(Object.keys(data as object)).not.toContain('avg_lead_time_days');
  });
});
