// Inventory Stage 1 / I2 (Owner-approved) — regression coverage for migration
// 219, which fixes the original "DEFECT-001" first-sale bug: fn_apply_stock_movement's
// backorder branch (p_allow_backorder=true, the mode fn_process_sale_stock_deduction
// always uses on every POS sale of a has_inventory item — see migration 105)
// used to insert a stock_movements row with quantity=0 whenever v_available=0,
// violating stock_movements' CHECK (quantity > 0). Confirmed live before this
// fix via direct RPC call against the real Supabase project.
import 'dotenv/config';
import { pickTestWarehouse } from '../../../../test/support/test-tenant';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

describe('zero-quantity backorder movement fix (Migration 219)', () => {
  let supabase: SupabaseClient;
  let tenantId: string;
  let warehouseId: string;
  let itemId: string;
  const cleanupBackorderIds: string[] = [];

  beforeAll(async () => {
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    );

    const warehouse = await pickTestWarehouse(supabase);
    warehouseId = warehouse.id;
    tenantId = warehouse.tenant_id;

    const { data: item, error } = await supabase
      .from('items')
      .insert({
        tenant_id: tenantId,
        name: 'QA I2 Zero-Qty Backorder Test Item',
        type: 'product',
        operation_type: 'sell',
        price: 10,
        has_inventory: true,
      })
      .select('id')
      .single();
    if (error) throw error;
    itemId = item.id;
  });

  afterAll(async () => {
    if (cleanupBackorderIds.length) {
      await supabase.from('backorders').delete().in('id', cleanupBackorderIds);
    }
    await supabase
      .from('stock_levels')
      .delete()
      .eq('warehouse_id', warehouseId)
      .eq('item_id', itemId);
    await supabase.from('items').delete().eq('id', itemId);
  });

  it('Test 1: selling against zero available stock with backorder allowed does not violate the stock_movements CHECK constraint', async () => {
    const { data, error } = await supabase.rpc('fn_apply_stock_movement', {
      p_tenant_id: tenantId,
      p_warehouse_id: warehouseId,
      p_location_id: null,
      p_item_id: itemId,
      p_variant_id: null,
      p_batch_id: null,
      p_movement_type: 'sale',
      p_direction: 'out',
      p_quantity: 5,
      p_unit_cost: 1,
      p_reference_type: 'order',
      p_reference_id: null,
      p_created_by: null,
      p_allow_negative: false,
      p_allow_backorder: true,
    });

    expect(error).toBeNull();
    // No physical movement occurred — the function returns a null-fields row
    // (id is null) rather than raising, confirming the INSERT was skipped.
    expect(data.id).toBeNull();
  });

  it('Test 2: a backorders row was created for the full unfulfilled quantity', async () => {
    const { data } = await supabase
      .from('backorders')
      .select('*')
      .eq('warehouse_id', warehouseId)
      .eq('item_id', itemId)
      .order('created_at', { ascending: false })
      .limit(1);

    expect(data).toHaveLength(1);
    expect(data[0].quantity).toBe(5);
    expect(data[0].status).toBe('open');
    cleanupBackorderIds.push(data[0].id);
  });

  it('Test 3: no stock_movements row was created for the zero-quantity deduction', async () => {
    const { data } = await supabase
      .from('stock_movements')
      .select('id')
      .eq('warehouse_id', warehouseId)
      .eq('item_id', itemId);

    expect(data).toHaveLength(0);
  });

  it('Test 4: stock_levels reflects the backorder, not a physical deduction', async () => {
    const { data } = await supabase
      .from('stock_levels')
      .select('quantity_on_hand, quantity_backorder')
      .eq('warehouse_id', warehouseId)
      .eq('item_id', itemId)
      .single();

    expect(data.quantity_on_hand).toBe(0);
    expect(data.quantity_backorder).toBe(5);
  });

  it('Test 5: a partial-availability backorder still records the real physical movement (regression guard — only the zero case is skipped)', async () => {
    // Receive 2 units in, so v_available=2 for the next sale of 5.
    const receiveResult = await supabase.rpc('fn_apply_stock_movement', {
      p_tenant_id: tenantId,
      p_warehouse_id: warehouseId,
      p_location_id: null,
      p_item_id: itemId,
      p_variant_id: null,
      p_batch_id: null,
      p_movement_type: 'receipt',
      p_direction: 'in',
      p_quantity: 2,
      p_unit_cost: 1,
      p_reference_type: 'test',
      p_reference_id: null,
      p_created_by: null,
    });
    expect(receiveResult.error).toBeNull();

    // The receipt marks 2 of the 5 backordered units 'fulfilled' in the
    // backorders table (FIFO fulfillment logic, unmodified by this fix) but
    // — correctly — does not re-subtract them from quantity_on_hand a
    // second time; on_hand is now 2 (from the receipt), backorder is now 3.
    // A follow-up sale of 5 therefore sees v_available=2 (not 0), so this
    // is a genuine PARTIAL case: v_deduct_qty=2 (>0), proving the fix only
    // skips the ledger insert for the exact v_deduct_qty=0 case, not every
    // backorder-triggering call.
    const saleResult = await supabase.rpc('fn_apply_stock_movement', {
      p_tenant_id: tenantId,
      p_warehouse_id: warehouseId,
      p_location_id: null,
      p_item_id: itemId,
      p_variant_id: null,
      p_batch_id: null,
      p_movement_type: 'sale',
      p_direction: 'out',
      p_quantity: 5,
      p_unit_cost: 1,
      p_reference_type: 'order',
      p_reference_id: null,
      p_created_by: null,
      p_allow_negative: false,
      p_allow_backorder: true,
    });
    expect(saleResult.error).toBeNull();
    expect(saleResult.data.id).not.toBeNull();
    expect(saleResult.data.quantity).toBe(2);

    const { data: bo } = await supabase
      .from('backorders')
      .select('id')
      .eq('warehouse_id', warehouseId)
      .eq('item_id', itemId)
      .eq('status', 'open');
    cleanupBackorderIds.push(...(bo ?? []).map((b) => b.id));
  });

  it('Test 6 (documented, not fixed — out of I2 scope per Master Plan): p_allow_negative cannot produce true negative on-hand stock, blocked by a different CHECK constraint', async () => {
    const { error } = await supabase.rpc('fn_apply_stock_movement', {
      p_tenant_id: tenantId,
      p_warehouse_id: warehouseId,
      p_location_id: null,
      p_item_id: itemId,
      p_variant_id: null,
      p_batch_id: null,
      p_movement_type: 'adjustment_out',
      p_direction: 'out',
      p_quantity: 3,
      p_unit_cost: 1,
      p_reference_type: 'test',
      p_reference_id: null,
      p_created_by: null,
      p_allow_negative: true,
      p_allow_backorder: false,
    });

    // Confirms the Master Plan's I2 investigation finding: p_allow_negative
    // does not achieve genuine negative stock — some other CHECK
    // constraint on stock_levels rejects it first. This is intentional
    // schema behavior (negative physical inventory should never be
    // representable), not a defect to fix under I2.
    expect(error).not.toBeNull();
    expect(error.message).toMatch(/violates check constraint/);
  });
});
