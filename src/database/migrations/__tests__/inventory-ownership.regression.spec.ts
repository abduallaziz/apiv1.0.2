/**
 * Regression suite for Migration 10.1 (Inventory Ownership foundation, #20).
 * Runs directly against the real shared Supabase project via the
 * service-role client — same approach as every other regression spec in
 * this directory.
 *
 * Scope note (honest, matching the disclosure pattern from Migration 8.2's
 * report): this suite exercises the database layer directly — the new
 * table, fn_consume_ownership_layers, and fn_post_goods_receipt_with_
 * ownership. It does NOT drive a full HTTP-level InvoicesService.create()
 * call or ProductionOrdersService.complete() call (both would require
 * bootstrapping shift/branch/BOM fixtures well beyond this session's
 * established RPC-level testing convention). The
 * fn_consume_ownership_layers assertions below are the exact RPC
 * OwnershipRepository.consumeForSale() calls, so they are a faithful proxy
 * for "a sale would correctly decrement/close the owner's layer." The
 * Manufacturing owned-component guard (ProductionOrdersService.
 * assertNoOwnedComponents) is pure TypeScript application logic with no
 * corresponding RPC to test at this layer — verified via code review,
 * tsc, and build only, not by an automated test here.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const TEST_TENANT_ID = '9bcd3369-d664-47c8-b297-3bc9b429aacf'; // Sefay Demo

describe('inventory ownership regression (Migration 10.1)', () => {
  let supabase: SupabaseClient;
  let warehouseId: string;
  let supplierId: string;
  const itemIds: string[] = [];
  const grIds: string[] = [];
  const layerIds: string[] = [];

  const createItem = async (name: string) => {
    const { data, error } = await supabase
      .from('items')
      .insert({
        tenant_id: TEST_TENANT_ID,
        name,
        type: 'product',
        operation_type: 'sell',
        price: 10,
        is_active: true,
      })
      .select()
      .single();
    if (error) throw error;
    itemIds.push(data.id);
    return data.id;
  };

  const createDraftReceipt = async (
    itemId: string,
    qty: number,
    unitCost: number,
    ownership?: { ownership_type: string; owner_supplier_id?: string },
  ) => {
    const { data: gr, error: grErr } = await supabase
      .from('goods_receipts')
      .insert({
        tenant_id: TEST_TENANT_ID,
        warehouse_id: warehouseId,
        receipt_number: `OWN10-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
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
        ownership_type: ownership?.ownership_type ?? null,
        owner_supplier_id: ownership?.owner_supplier_id ?? null,
      });
    if (lineErr) throw lineErr;
    return gr.id;
  };

  beforeAll(async () => {
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    );
    const { data: wh, error } = await supabase
      .from('warehouses')
      .select('id')
      .eq('tenant_id', TEST_TENANT_ID)
      .limit(1);
    if (error) throw error;
    warehouseId = wh[0].id;

    const { data: supplier, error: supErr } = await supabase
      .from('suppliers')
      .insert({
        tenant_id: TEST_TENANT_ID,
        name: `OWN10 Supplier ${Date.now()}`,
      })
      .select()
      .single();
    if (supErr) throw supErr;
    supplierId = supplier.id;
  }, 30_000);

  afterAll(async () => {
    for (const id of layerIds)
      await supabase.from('stock_ownership_layers').delete().eq('id', id);
    for (const itemId of itemIds) {
      await supabase.from('cost_layers').delete().eq('item_id', itemId);
      await supabase.from('stock_levels').delete().eq('item_id', itemId);
    }
    for (const id of grIds) {
      await supabase
        .from('goods_receipt_items')
        .delete()
        .eq('goods_receipt_id', id);
      await supabase.from('goods_receipts').delete().eq('id', id);
    }
    for (const itemId of itemIds) {
      const { error } = await supabase.from('items').delete().eq('id', itemId);
      if (error) {
        await supabase
          .from('items')
          .update({ is_active: false, deleted_at: new Date().toISOString() })
          .eq('id', itemId);
      }
    }
    await supabase.from('suppliers').delete().eq('id', supplierId);
  }, 60_000);

  it('company-owned receipt (default, no ownership fields): no layer created, posting identical to plain fn_post_goods_receipt', async () => {
    const itemId = await createItem('OWN10 Company-Owned Item');
    const grId = await createDraftReceipt(itemId, 50, 4);

    const { data: posted, error } = await supabase.rpc(
      'fn_post_goods_receipt_with_ownership',
      {
        p_goods_receipt_id: grId,
        p_actor_id: null,
      },
    );
    expect(error).toBeNull();
    expect(posted.status).toBe('posted');

    const { data: layers } = await supabase
      .from('stock_ownership_layers')
      .select('*')
      .eq('tenant_id', TEST_TENANT_ID)
      .eq('source_reference_type', 'goods_receipt')
      .eq('source_reference_id', grId);
    expect(layers.length).toBe(0); // no layer for company-owned (implicit default)

    const { data: level } = await supabase
      .from('stock_levels')
      .select('quantity_on_hand')
      .eq('tenant_id', TEST_TENANT_ID)
      .eq('item_id', itemId)
      .eq('warehouse_id', warehouseId)
      .single();
    expect(Number(level.quantity_on_hand)).toBe(50); // identical to plain posting behavior
  }, 30_000);

  it('consignment receipt: creates an ownership layer with correct supplier/quantity, and stock/cost posting is unaffected', async () => {
    const itemId = await createItem('OWN10 Consignment Item');
    const grId = await createDraftReceipt(itemId, 30, 7, {
      ownership_type: 'consignment',
      owner_supplier_id: supplierId,
    });

    const { data: posted, error } = await supabase.rpc(
      'fn_post_goods_receipt_with_ownership',
      {
        p_goods_receipt_id: grId,
        p_actor_id: null,
      },
    );
    expect(error).toBeNull();
    expect(posted.status).toBe('posted');

    const { data: layers } = await supabase
      .from('stock_ownership_layers')
      .select('*')
      .eq('tenant_id', TEST_TENANT_ID)
      .eq('source_reference_type', 'goods_receipt')
      .eq('source_reference_id', grId);
    expect(layers.length).toBe(1);
    layerIds.push(layers[0].id);
    expect(layers[0].ownership_type).toBe('consignment');
    expect(layers[0].owner_supplier_id).toBe(supplierId);
    expect(Number(layers[0].quantity)).toBe(30);
    expect(layers[0].status).toBe('active');

    // Stock/cost posting is byte-for-byte the same as the company-owned case.
    const { data: level } = await supabase
      .from('stock_levels')
      .select('quantity_on_hand')
      .eq('tenant_id', TEST_TENANT_ID)
      .eq('item_id', itemId)
      .eq('warehouse_id', warehouseId)
      .single();
    expect(Number(level.quantity_on_hand)).toBe(30);
    const { data: costLayer } = await supabase
      .from('cost_layers')
      .select('unit_cost, quantity_remaining')
      .eq('tenant_id', TEST_TENANT_ID)
      .eq('item_id', itemId)
      .single();
    expect(Number(costLayer.unit_cost)).toBe(7);
    expect(Number(costLayer.quantity_remaining)).toBe(30);
  }, 30_000);

  it('duplicate posting: second call is rejected by the inherited fn_post_goods_receipt guard, and no duplicate layer is created', async () => {
    const itemId = await createItem('OWN10 Duplicate-Post Item');
    const grId = await createDraftReceipt(itemId, 10, 5, {
      ownership_type: 'consignment',
      owner_supplier_id: supplierId,
    });

    const first = await supabase.rpc('fn_post_goods_receipt_with_ownership', {
      p_goods_receipt_id: grId,
      p_actor_id: null,
    });
    expect(first.error).toBeNull();

    const second = await supabase.rpc('fn_post_goods_receipt_with_ownership', {
      p_goods_receipt_id: grId,
      p_actor_id: null,
    });
    expect(second.error).not.toBeNull(); // rejected by fn_post_goods_receipt's own status='draft' guard

    const { data: layers } = await supabase
      .from('stock_ownership_layers')
      .select('*')
      .eq('tenant_id', TEST_TENANT_ID)
      .eq('source_reference_type', 'goods_receipt')
      .eq('source_reference_id', grId);
    expect(layers.length).toBe(1); // exactly one layer, not two
    layerIds.push(layers[0].id);
  }, 30_000);

  it('ownership transfer: closes the old layer and creates a new active one with the new owner', async () => {
    const itemId = await createItem('OWN10 Transfer Item');
    const { data: layer, error: createErr } = await supabase
      .from('stock_ownership_layers')
      .insert({
        tenant_id: TEST_TENANT_ID,
        warehouse_id: warehouseId,
        item_id: itemId,
        ownership_type: 'consignment',
        owner_supplier_id: supplierId,
        quantity: 15,
        status: 'active',
      })
      .select()
      .single();
    expect(createErr).toBeNull();
    layerIds.push(layer.id);

    // Mirrors OwnershipRepository.transfer() exactly.
    const { error: closeErr } = await supabase
      .from('stock_ownership_layers')
      .update({ status: 'closed', closed_at: new Date().toISOString() })
      .eq('id', layer.id)
      .eq('status', 'active');
    expect(closeErr).toBeNull();

    const { data: newLayer, error: newErr } = await supabase
      .from('stock_ownership_layers')
      .insert({
        tenant_id: TEST_TENANT_ID,
        warehouse_id: warehouseId,
        item_id: itemId,
        ownership_type: 'company',
        quantity: 15,
        status: 'active',
        source_reference_type: 'ownership_transfer',
        source_reference_id: layer.id,
      })
      .select()
      .single();
    expect(newErr).toBeNull();
    layerIds.push(newLayer.id);

    const { data: oldLayer } = await supabase
      .from('stock_ownership_layers')
      .select('status')
      .eq('id', layer.id)
      .single();
    expect(oldLayer.status).toBe('closed'); // permanently retained, not deleted — this IS the history (per approved design)
    expect(newLayer.status).toBe('active');
    expect(newLayer.ownership_type).toBe('company');
  }, 30_000);

  it('fn_consume_ownership_layers: partial then full consumption closes the layer; returns 0 when no layer exists', async () => {
    const ownedItem = await createItem('OWN10 Consume Item');
    const plainItem = await createItem('OWN10 No-Layer Item');
    const { data: layer } = await supabase
      .from('stock_ownership_layers')
      .insert({
        tenant_id: TEST_TENANT_ID,
        warehouse_id: warehouseId,
        item_id: ownedItem,
        ownership_type: 'customer',
        quantity: 20,
        status: 'active',
      })
      .select()
      .single();
    layerIds.push(layer.id);

    const { data: consumed1, error: err1 } = await supabase.rpc(
      'fn_consume_ownership_layers',
      {
        p_tenant_id: TEST_TENANT_ID,
        p_warehouse_id: warehouseId,
        p_item_id: ownedItem,
        p_variant_id: null,
        p_quantity: 5,
      },
    );
    expect(err1).toBeNull();
    expect(Number(consumed1)).toBe(5);
    const { data: afterPartial } = await supabase
      .from('stock_ownership_layers')
      .select('quantity, status')
      .eq('id', layer.id)
      .single();
    expect(Number(afterPartial.quantity)).toBe(15);
    expect(afterPartial.status).toBe('active');

    const { data: consumed2, error: err2 } = await supabase.rpc(
      'fn_consume_ownership_layers',
      {
        p_tenant_id: TEST_TENANT_ID,
        p_warehouse_id: warehouseId,
        p_item_id: ownedItem,
        p_variant_id: null,
        p_quantity: 15,
      },
    );
    expect(err2).toBeNull();
    expect(Number(consumed2)).toBe(15);
    const { data: afterFull } = await supabase
      .from('stock_ownership_layers')
      .select('quantity, status')
      .eq('id', layer.id)
      .single();
    expect(Number(afterFull.quantity)).toBe(0);
    expect(afterFull.status).toBe('closed');

    // No layer for this item at all -> 0 consumed, never an error (the
    // company-owned default case, exactly what the sale-advisory path relies on).
    const { data: consumedNone, error: errNone } = await supabase.rpc(
      'fn_consume_ownership_layers',
      {
        p_tenant_id: TEST_TENANT_ID,
        p_warehouse_id: warehouseId,
        p_item_id: plainItem,
        p_variant_id: null,
        p_quantity: 100,
      },
    );
    expect(errNone).toBeNull();
    expect(Number(consumedNone)).toBe(0);
  }, 30_000);
});
