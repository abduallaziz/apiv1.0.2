// Inventory Stage 1 / I4 (Owner-approved) — regression coverage for
// migration 220, which adds fn_reverse_goods_receipt: the previously-missing
// ability to undo a posted goods receipt's stock/cost-layer/PO effects.
// Confirmed absent before this migration (only 'draft' receipts could be
// cancelled).
import 'dotenv/config';
import { pickTestWarehouse } from '../../../../test/support/test-tenant';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

describe('goods receipt reversal (Migration 220)', () => {
  let supabase: SupabaseClient;
  let tenantId: string;
  let warehouseId: string;
  let itemId: string;
  let fifoItemId: string;
  const receiptIds: string[] = [];

  beforeAll(async () => {
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    );

    const warehouse = await pickTestWarehouse(supabase);
    warehouseId = warehouse.id;
    tenantId = warehouse.tenant_id;

    // Self-healing residue cleanup: if a prior run of this suite crashed
    // before its own afterAll ran, its fixture items/receipts are orphaned
    // (receiptIds is in-memory only, lost on crash). Sweep them up here,
    // scoped strictly to this tenant and this suite's fixed fixture names,
    // so a crashed run never accumulates residue across sessions. Filtered
    // to deleted_at IS NULL so already-soft-deleted rows from previous
    // sweeps are never rescanned (keeps this query cheap forever).
    // stock_movements is a genuine immutable ledger (trg_stock_movements_no_delete
    // / fn_block_stock_movements_mutation) and is never deleted or targeted
    // here — items are soft-deleted instead, exactly because they can never
    // be hard-deleted while ledger rows reference them.
    const { data: staleItems } = await supabase
      .from('items')
      .select('id')
      .eq('tenant_id', tenantId)
      .ilike('name', 'QA I4 %')
      .is('deleted_at', null);
    if (staleItems?.length) {
      const staleIds = staleItems.map((i) => i.id);
      const { data: staleReceiptItems } = await supabase
        .from('goods_receipt_items')
        .select('goods_receipt_id')
        .in('item_id', staleIds);
      const staleReceiptIds = [
        ...new Set((staleReceiptItems ?? []).map((r) => r.goods_receipt_id)),
      ];
      await Promise.all([
        supabase.from('cost_layers').delete().in('item_id', staleIds),
        supabase.from('stock_levels').delete().in('item_id', staleIds),
        staleReceiptIds.length
          ? supabase
              .from('goods_receipt_items')
              .delete()
              .in('goods_receipt_id', staleReceiptIds)
          : Promise.resolve(null),
      ]);
      if (staleReceiptIds.length) {
        await supabase.from('goods_receipts').delete().in('id', staleReceiptIds);
      }
      await supabase
        .from('items')
        .update({ is_active: false, deleted_at: new Date().toISOString() })
        .in('id', staleIds);
    }

    const { data: item } = await supabase
      .from('items')
      .insert({
        tenant_id: tenantId,
        name: 'QA I4 Goods Receipt Reversal Item',
        type: 'product',
        operation_type: 'sell',
        price: 10,
        has_inventory: true,
        costing_method: 'fifo',
      })
      .select('id')
      .single();
    itemId = item.id;

    const { data: fifoItem } = await supabase
      .from('items')
      .insert({
        tenant_id: tenantId,
        name: 'QA I4 Consumed-Before-Reversal Item',
        type: 'product',
        operation_type: 'sell',
        price: 10,
        has_inventory: true,
        costing_method: 'fifo',
      })
      .select('id')
      .single();
    fifoItemId = fifoItem.id;
  });

  afterAll(async () => {
    // Independent deletes issued in parallel (previously a fully serial
    // loop of round-trips, ~4s baseline latency alone against the hosted
    // PostgREST API — measured directly, tipping past Jest's default
    // 5000ms hook timeout under any real contention). Only the true FK
    // order (goods_receipt_items -> goods_receipts -> items) remains
    // sequential.
    //
    // stock_movements is deliberately never targeted here: it is a real
    // immutable ledger (trg_stock_movements_no_delete enforced via
    // fn_block_stock_movements_mutation, migration-level business rule —
    // not a test artifact) and every delete against it has always been a
    // silent no-op. Because of that, items referenced by a stock_movements
    // row can never be hard-deleted (FK RESTRICT) — items are soft-deleted
    // below instead, which is the correct, deterministic, permanent
    // behavior for this fixture, not a timeout workaround.
    const itemIds = [itemId, fifoItemId];
    await Promise.all([
      supabase.from('cost_layers').delete().in('item_id', itemIds),
      supabase.from('stock_levels').delete().in('item_id', itemIds),
      receiptIds.length
        ? supabase
            .from('goods_receipt_items')
            .delete()
            .in('goods_receipt_id', receiptIds)
        : Promise.resolve(null),
    ]);
    if (receiptIds.length) {
      await supabase.from('goods_receipts').delete().in('id', receiptIds);
    }
    await supabase
      .from('items')
      .update({ is_active: false, deleted_at: new Date().toISOString() })
      .in('id', itemIds);
  });

  async function createAndPostReceipt(
    targetItemId: string,
    quantity: number,
    unitCost: number,
  ) {
    const { data: receipt } = await supabase
      .from('goods_receipts')
      .insert({
        tenant_id: tenantId,
        warehouse_id: warehouseId,
        receipt_number: `QA-I4-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        status: 'draft',
      })
      .select('id')
      .single();
    const receiptId = receipt.id;
    receiptIds.push(receiptId);

    await supabase.from('goods_receipt_items').insert({
      tenant_id: tenantId,
      goods_receipt_id: receiptId,
      item_id: targetItemId,
      quantity_received: quantity,
      unit_cost: unitCost,
    });

    const { error: postError } = await supabase.rpc('fn_post_goods_receipt', {
      p_goods_receipt_id: receiptId,
      p_actor_id: null,
    });
    if (postError) throw postError;

    return receiptId;
  }

  it('Test 1: reversing a posted receipt with nothing consumed restores stock and cost layers', async () => {
    const receiptId = await createAndPostReceipt(itemId, 10, 5);

    const { data: levelBefore } = await supabase
      .from('stock_levels')
      .select('quantity_on_hand')
      .eq('item_id', itemId)
      .single();
    expect(levelBefore.quantity_on_hand).toBe(10);

    const { data: reversed, error } = await supabase.rpc(
      'fn_reverse_goods_receipt',
      {
        p_goods_receipt_id: receiptId,
        p_actor_id: null,
      },
    );

    expect(error).toBeNull();
    expect(reversed.status).toBe('reversed');

    const { data: levelAfter } = await supabase
      .from('stock_levels')
      .select('quantity_on_hand')
      .eq('item_id', itemId)
      .single();
    expect(levelAfter.quantity_on_hand).toBe(0);

    const { data: layers } = await supabase
      .from('cost_layers')
      .select('quantity_remaining')
      .eq('item_id', itemId);
    expect(layers.every((l) => Number(l.quantity_remaining) === 0)).toBe(true);
  }, 30_000);

  it('Test 2: reversing an already-reversed receipt is rejected (idempotency — no double reversal)', async () => {
    const receiptId = receiptIds[receiptIds.length - 1];

    const { error } = await supabase.rpc('fn_reverse_goods_receipt', {
      p_goods_receipt_id: receiptId,
      p_actor_id: null,
    });

    expect(error).not.toBeNull();
    expect(error.message).toMatch(/is not posted/);
  }, 30_000);

  it('Test 3: reversing a receipt whose stock has already been partially consumed is rejected, with zero mutation', async () => {
    const receiptId = await createAndPostReceipt(fifoItemId, 10, 5);

    // Consume 4 of the 10 received units via the real two-step sale
    // pattern fn_process_sale_stock_deduction uses: cost-layer consumption
    // first (this is what the reversal's pre-flight check inspects), then
    // the physical stock movement.
    const { data: unitCost, error: costError } = await supabase.rpc(
      'fn_consume_cost_layers',
      {
        p_tenant_id: tenantId,
        p_warehouse_id: warehouseId,
        p_item_id: fifoItemId,
        p_variant_id: null,
        p_quantity: 4,
      },
    );
    expect(costError).toBeNull();

    const { error: consumeError } = await supabase.rpc(
      'fn_apply_stock_movement',
      {
        p_tenant_id: tenantId,
        p_warehouse_id: warehouseId,
        p_location_id: null,
        p_item_id: fifoItemId,
        p_variant_id: null,
        p_batch_id: null,
        p_movement_type: 'sale',
        p_direction: 'out',
        p_quantity: 4,
        p_unit_cost: Number(unitCost),
        p_reference_type: 'order',
        p_reference_id: null,
        p_created_by: null,
      },
    );
    expect(consumeError).toBeNull();

    const { data: levelBefore } = await supabase
      .from('stock_levels')
      .select('quantity_on_hand')
      .eq('item_id', fifoItemId)
      .single();
    expect(levelBefore.quantity_on_hand).toBe(6);

    const { error: reverseError } = await supabase.rpc(
      'fn_reverse_goods_receipt',
      {
        p_goods_receipt_id: receiptId,
        p_actor_id: null,
      },
    );

    expect(reverseError).not.toBeNull();
    expect(reverseError.message).toMatch(/GOODS_RECEIPT_REVERSAL_UNSAFE/);

    // Zero mutation: stock unchanged, receipt still posted.
    const { data: levelAfter } = await supabase
      .from('stock_levels')
      .select('quantity_on_hand')
      .eq('item_id', fifoItemId)
      .single();
    expect(levelAfter.quantity_on_hand).toBe(6);

    const { data: receiptAfter } = await supabase
      .from('goods_receipts')
      .select('status')
      .eq('id', receiptId)
      .single();
    expect(receiptAfter.status).toBe('posted');
  }, 30_000);

  it('Test 4: reversing a non-existent receipt id raises "not found"', async () => {
    const { error } = await supabase.rpc('fn_reverse_goods_receipt', {
      p_goods_receipt_id: '00000000-0000-0000-0000-000000000000',
      p_actor_id: null,
    });

    expect(error).not.toBeNull();
    expect(error.message).toMatch(/not found/);
  }, 30_000);
});
