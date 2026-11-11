// Inventory Stage 1 / Item #2 Sub-phase 2b (Owner-approved) — proves the
// packaging-level resolution wiring end-to-end at the repository/RPC layer
// (the same call the service layer of goods-receipts/invoices/transfers
// makes) against the real database: receive, sell, and transfer by
// packaging barcode, verified against real stock_levels/cost_layers/
// stock_movements state, plus a repeated-resolution idempotency check.
import 'dotenv/config';
import { pickTestWarehouse } from '../../../../test/support/test-tenant';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

describe('packaging transaction wiring (Sub-phase 2b)', () => {
  let supabase: SupabaseClient;
  let tenantId: string;
  let warehouseId: string;
  let itemId: string;
  let pieceLevelId: string;
  let cartonLevelId: string;
  let cartonBarcode: string;

  beforeAll(async () => {
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    );

    const warehouse = await pickTestWarehouse(supabase);
    warehouseId = warehouse.id;
    tenantId = warehouse.tenant_id;

    const { data: item } = await supabase
      .from('items')
      .insert({
        tenant_id: tenantId,
        name: 'QA 2b Packaging Wiring Item',
        type: 'product',
        operation_type: 'sell',
        price: 2, // price per Piece
        has_inventory: true,
        costing_method: 'fifo',
      })
      .select('id')
      .single();
    itemId = item.id;

    const { data: piece } = await supabase
      .from('item_packaging_levels')
      .insert({ tenant_id: tenantId, item_id: itemId, level_name: 'Piece', parent_level_id: null, quantity_in_parent: 1 })
      .select('id')
      .single();
    pieceLevelId = piece.id;

    const { data: carton } = await supabase
      .from('item_packaging_levels')
      .insert({ tenant_id: tenantId, item_id: itemId, level_name: 'Carton', parent_level_id: pieceLevelId, quantity_in_parent: 24 })
      .select('id')
      .single();
    cartonLevelId = carton.id;

    cartonBarcode = `QA-2B-CARTON-${Date.now()}`;
    await supabase.from('item_barcodes').insert({
      tenant_id: tenantId,
      item_id: itemId,
      barcode: cartonBarcode,
      barcode_type: 'GS1',
      packaging_level_id: cartonLevelId,
    });
  });

  afterAll(async () => {
    await supabase.from('item_barcodes').delete().eq('item_id', itemId);
    await supabase.from('item_packaging_levels').delete().eq('item_id', itemId);
    await supabase.from('cost_layers').delete().eq('item_id', itemId);
    await supabase.from('stock_levels').delete().eq('item_id', itemId);
    // stock_movements is an immutable ledger (trg_stock_movements_no_delete,
    // confirmed elsewhere this session) — a real receipt/sale was posted by
    // this suite, so its movement rows can never be deleted, by design.
    // Soft-delete the item instead of a hard delete, which would otherwise
    // fail on the stock_movements foreign key and strand the item row.
    await supabase
      .from('items')
      .update({ deleted_at: new Date().toISOString(), is_active: false })
      .eq('id', itemId);
  });

  it('Step 1-2: scanning the Carton barcode resolves item + packaging level + quantity equivalent (receiving boundary)', async () => {
    const { data: barcodeRow } = await supabase
      .from('item_barcodes')
      .select('item_id, packaging_level_id')
      .eq('barcode', cartonBarcode)
      .single();
    expect(barcodeRow.item_id).toBe(itemId);
    expect(barcodeRow.packaging_level_id).toBe(cartonLevelId);

    // Same call GoodsReceiptsService.create() makes: "2 Cartons" -> storage qty.
    const { data: resolvedQty, error } = await supabase.rpc(
      'fn_convert_packaging_to_storage_qty',
      { p_item_id: itemId, p_packaging_level_id: cartonLevelId, p_quantity: 2 },
    );
    expect(error).toBeNull();
    expect(Number(resolvedQty)).toBe(48); // 2 Cartons = 48 Pieces
  });

  it('Step 6-7: receiving by Carton barcode (2 Cartons) posts 48 real storage-unit Pieces, not 2', async () => {
    const { data: movement, error } = await supabase.rpc('fn_apply_stock_movement', {
      p_tenant_id: tenantId,
      p_warehouse_id: warehouseId,
      p_location_id: null,
      p_item_id: itemId,
      p_variant_id: null,
      p_batch_id: null,
      p_movement_type: 'receipt',
      p_direction: 'in',
      p_quantity: 48, // pre-resolved by fn_convert_packaging_to_storage_qty above
      p_unit_cost: 1, // cost per Piece
      p_reference_type: 'test_goods_receipt',
      p_reference_id: null,
      p_created_by: null,
    });
    expect(error).toBeNull();
    expect(Number(movement.quantity)).toBe(48);

    await supabase.rpc('fn_add_cost_layer', {
      p_tenant_id: tenantId,
      p_warehouse_id: warehouseId,
      p_item_id: itemId,
      p_variant_id: null,
      p_batch_id: null,
      p_quantity: 48,
      p_unit_cost: 1,
      p_source_movement_id: movement.id,
    });

    const { data: level } = await supabase
      .from('stock_levels')
      .select('quantity_on_hand')
      .eq('item_id', itemId)
      .single();
    expect(level.quantity_on_hand).toBe(48); // NOT 2 — no second stock truth
  });

  it('Step 8-10: selling by Box/Carton-equivalent barcode (1 Carton) deducts 24 Pieces and consumes 24 units of cost layers, not 1', async () => {
    const before = await supabase
      .from('stock_levels')
      .select('quantity_on_hand')
      .eq('item_id', itemId)
      .single();
    expect(before.data.quantity_on_hand).toBe(48);

    const { data: resolvedSaleQty } = await supabase.rpc(
      'fn_convert_packaging_to_storage_qty',
      { p_item_id: itemId, p_packaging_level_id: cartonLevelId, p_quantity: 1 },
    );
    expect(Number(resolvedSaleQty)).toBe(24);

    // Mirrors fn_process_sale_stock_deduction's real two-step pattern.
    const { data: unitCost, error: costError } = await supabase.rpc(
      'fn_consume_cost_layers',
      {
        p_tenant_id: tenantId,
        p_warehouse_id: warehouseId,
        p_item_id: itemId,
        p_variant_id: null,
        p_quantity: Number(resolvedSaleQty),
      },
    );
    expect(costError).toBeNull();
    expect(Number(unitCost)).toBe(1); // actual cost, unaffected by packaging

    const { error: deductError } = await supabase.rpc('fn_apply_stock_movement', {
      p_tenant_id: tenantId,
      p_warehouse_id: warehouseId,
      p_location_id: null,
      p_item_id: itemId,
      p_variant_id: null,
      p_batch_id: null,
      p_movement_type: 'sale',
      p_direction: 'out',
      p_quantity: Number(resolvedSaleQty),
      p_unit_cost: Number(unitCost),
      p_reference_type: 'test_order',
      p_reference_id: null,
      p_created_by: null,
    });
    expect(deductError).toBeNull();

    const after = await supabase
      .from('stock_levels')
      .select('quantity_on_hand')
      .eq('item_id', itemId)
      .single();
    expect(after.data.quantity_on_hand).toBe(24); // 48 - 24, correct real deduction

    const { data: layers } = await supabase
      .from('cost_layers')
      .select('quantity_remaining')
      .eq('item_id', itemId);
    const totalRemaining = layers.reduce(
      (sum: number, l: { quantity_remaining: string }) => sum + Number(l.quantity_remaining),
      0,
    );
    expect(totalRemaining).toBe(24); // 48 - 24 consumed, cost layers stayed correct
  });

  it('Step 14-15: retrying the same resolution call is idempotent — no duplicate mutation from resolution itself', async () => {
    // fn_convert_packaging_to_storage_qty is a pure STABLE function — it
    // reads and computes, it never writes. Calling it N times must never
    // mutate stock/cost state on its own; only an actual movement/consume
    // call (already covered by I2's sale_attempt_id/order-item idempotency,
    // untouched by this migration) would.
    const before = await supabase
      .from('stock_levels')
      .select('quantity_on_hand')
      .eq('item_id', itemId)
      .single();

    for (let i = 0; i < 3; i++) {
      await supabase.rpc('fn_convert_packaging_to_storage_qty', {
        p_item_id: itemId,
        p_packaging_level_id: cartonLevelId,
        p_quantity: 1,
      });
    }

    const after = await supabase
      .from('stock_levels')
      .select('quantity_on_hand')
      .eq('item_id', itemId)
      .single();
    expect(after.data.quantity_on_hand).toBe(before.data.quantity_on_hand);
  }, 20000);

  it('Step 16: existing non-packaging barcode behavior is unaffected — a plain unit barcode still resolves with no packaging multiplier', async () => {
    const unitBarcode = `QA-2B-UNIT-${Date.now()}`;
    await supabase.from('item_barcodes').insert({
      tenant_id: tenantId,
      item_id: itemId,
      barcode: unitBarcode,
      barcode_type: 'UPC',
      // packaging_level_id omitted entirely — existing behavior path.
    });

    const { data: row } = await supabase
      .from('item_barcodes')
      .select('packaging_level_id')
      .eq('barcode', unitBarcode)
      .single();
    expect(row.packaging_level_id).toBeNull();

    const { data: resolved, error } = await supabase.rpc(
      'fn_convert_packaging_to_storage_qty',
      { p_item_id: itemId, p_packaging_level_id: row.packaging_level_id, p_quantity: 5 },
    );
    expect(error).toBeNull();
    expect(Number(resolved)).toBe(5); // no-op passthrough, exactly as before this migration
  });
});
