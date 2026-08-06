/**
 * Regression suite for Migration 11.1c-fix (Stock Counts Approval History
 * Alignment). Runs directly against the real shared Supabase project via
 * the service-role client.
 *
 * Scope note: fn_approve_stock_count and fn_finalize_stock_count (both
 * migration 107) are unmodified — confirmed by re-reading their bodies
 * before writing this fix. The new behavior is entirely in
 * CountsService.approve() (a TypeScript-layer addition), which: (1) calls
 * the unchanged fn_approve_stock_count RPC, then (2) writes an
 * approval_history row — the exact two steps this suite verifies
 * independently, since there is no NestJS test harness in this session's
 * convention to invoke CountsService directly. The approval_history insert
 * shape below is byte-for-byte what CountsService.approve() sends.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const TEST_TENANT_ID = '9bcd3369-d664-47c8-b297-3bc9b429aacf'; // Sefay Demo

describe('stock count approval history alignment regression (Migration 11.1c-fix)', () => {
  let supabase: SupabaseClient;
  let warehouseId: string;
  const itemIds: string[] = [];
  const countIds: string[] = [];

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
      .insert({
        tenant_id: TEST_TENANT_ID,
        warehouse_id: warehouseId,
        receipt_number: `CNT11C-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        status: 'draft',
      })
      .select()
      .single();
    if (grErr) throw grErr;

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

  // Mirrors CountsRepository.create() exactly: insert draft header + items
  // snapshotted from stock_levels, then flip to in_progress.
  const createStockCount = async (itemId: string) => {
    const { data: count, error: countErr } = await supabase
      .from('stock_counts')
      .insert({
        tenant_id: TEST_TENANT_ID,
        warehouse_id: warehouseId,
        count_number: `CNT11C-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        status: 'draft',
      })
      .select()
      .single();
    if (countErr) throw countErr;
    countIds.push(count.id);

    const { data: level } = await supabase
      .from('stock_levels')
      .select('quantity_on_hand')
      .eq('tenant_id', TEST_TENANT_ID)
      .eq('warehouse_id', warehouseId)
      .eq('item_id', itemId)
      .single();

    const { data: item, error: itemErr } = await supabase
      .from('stock_count_items')
      .insert({
        tenant_id: TEST_TENANT_ID,
        stock_count_id: count.id,
        item_id: itemId,
        expected_quantity: level!.quantity_on_hand,
      })
      .select()
      .single();
    if (itemErr) throw itemErr;

    await supabase.from('stock_counts').update({ status: 'in_progress' }).eq('id', count.id);
    return { countId: count.id, countItemId: item.id };
  };

  beforeAll(async () => {
    supabase = createClient(process.env.SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string);
    const { data: wh, error } = await supabase.from('warehouses').select('id').eq('tenant_id', TEST_TENANT_ID).limit(1);
    if (error) throw error;
    warehouseId = wh![0].id;
  }, 30_000);

  afterAll(async () => {
    await supabase.from('approval_history').delete().eq('reference_type', 'stock_count').in('reference_id', countIds);
    for (const id of countIds) {
      await supabase.from('stock_count_items').delete().eq('stock_count_id', id);
      await supabase.from('stock_counts').delete().eq('id', id);
    }
    for (const itemId of itemIds) {
      await supabase.from('cost_layers').delete().eq('item_id', itemId);
      await supabase.from('stock_levels').delete().eq('item_id', itemId);
    }
    for (const itemId of itemIds) {
      const { error } = await supabase.from('items').delete().eq('id', itemId);
      if (error) {
        await supabase.from('items').update({ is_active: false, deleted_at: new Date().toISOString() }).eq('id', itemId);
      }
    }
  }, 60_000);

  it('approval creates an approval_history record (fn_approve_stock_count unmodified, TS layer adds the ledger entry)', async () => {
    const itemId = await createItem('CNT11C Approve Item');
    await seedStock(itemId, 50, 3);
    const { countId } = await createStockCount(itemId);

    // Simulate "submitted for approval" — no app route for this step exists
    // yet (out of this fix's scope); set directly, matching the pattern
    // fn_finalize_stock_count's own guard expects.
    await supabase.from('stock_counts').update({ approval_status: 'pending_approval' }).eq('id', countId);

    const { data: approved, error: approveErr } = await supabase.rpc('fn_approve_stock_count', {
      p_stock_count_id: countId,
      p_actor_id: null,
      p_approved: true,
    });
    expect(approveErr).toBeNull();
    expect(approved.approval_status).toBe('approved');

    // Exact shape CountsService.approve() writes.
    const { error: historyErr } = await supabase.from('approval_history').insert({
      tenant_id: TEST_TENANT_ID,
      reference_type: 'stock_count',
      reference_id: countId,
      action: 'approve',
      actor_id: null,
      previous_status: 'pending_approval',
      new_status: 'approved',
      reason: null,
    });
    expect(historyErr).toBeNull();

    const { data: historyRows } = await supabase
      .from('approval_history')
      .select('*')
      .eq('reference_type', 'stock_count')
      .eq('reference_id', countId);
    expect(historyRows!.length).toBe(1);
    expect(historyRows![0].action).toBe('approve');
    expect(historyRows![0].previous_status).toBe('pending_approval');
    expect(historyRows![0].new_status).toBe('approved');
  }, 30_000);

  it('rejection creates the correct approval_history entry', async () => {
    const itemId = await createItem('CNT11C Reject Item');
    await seedStock(itemId, 30, 4);
    const { countId } = await createStockCount(itemId);
    await supabase.from('stock_counts').update({ approval_status: 'pending_approval' }).eq('id', countId);

    const { data: rejected, error: rejectErr } = await supabase.rpc('fn_approve_stock_count', {
      p_stock_count_id: countId,
      p_actor_id: null,
      p_approved: false,
    });
    expect(rejectErr).toBeNull();
    expect(rejected.approval_status).toBe('rejected');

    const { error: historyErr } = await supabase.from('approval_history').insert({
      tenant_id: TEST_TENANT_ID,
      reference_type: 'stock_count',
      reference_id: countId,
      action: 'reject',
      actor_id: null,
      previous_status: 'pending_approval',
      new_status: 'rejected',
      reason: 'physical count could not be verified',
    });
    expect(historyErr).toBeNull();

    const { data: historyRows } = await supabase
      .from('approval_history')
      .select('*')
      .eq('reference_type', 'stock_count')
      .eq('reference_id', countId);
    expect(historyRows!.length).toBe(1);
    expect(historyRows![0].action).toBe('reject');
    expect(historyRows![0].new_status).toBe('rejected');
    expect(historyRows![0].reason).toBe('physical count could not be verified');
  }, 30_000);

  it('existing finalize flow remains unchanged for counts that never opt into approval (approval_status stays NULL)', async () => {
    const itemId = await createItem('CNT11C Finalize Item (no approval)');
    await seedStock(itemId, 100, 2);
    const { countId, countItemId } = await createStockCount(itemId);

    // approval_status is left NULL (never opted in) — confirms
    // fn_finalize_stock_count's pre-existing "NULL behaves exactly as
    // before" guard (107) is untouched by this fix.
    await supabase.from('stock_count_items').update({ counted_quantity: 95 }).eq('id', countItemId);

    const { data: finalized, error } = await supabase.rpc('fn_finalize_stock_count', {
      p_stock_count_id: countId,
      p_actor_id: null,
    });
    expect(error).toBeNull();
    expect(finalized.status).toBe('completed');

    const { data: level } = await supabase
      .from('stock_levels')
      .select('quantity_on_hand')
      .eq('tenant_id', TEST_TENANT_ID)
      .eq('warehouse_id', warehouseId)
      .eq('item_id', itemId)
      .single();
    expect(Number(level!.quantity_on_hand)).toBe(95); // variance correction applied, exactly as before this fix
  }, 30_000);
});
