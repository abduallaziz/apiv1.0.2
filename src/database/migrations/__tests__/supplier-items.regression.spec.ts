/**
 * Regression suite for Migration 12.1 (Supplier-Item Lead Time & MOQ, #22).
 * Runs directly against the real shared Supabase project via the
 * service-role client — same approach as every other regression spec in
 * this directory.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const TEST_TENANT_ID = '9bcd3369-d664-47c8-b297-3bc9b429aacf'; // Sefay Demo

describe('supplier items regression (Migration 12.1)', () => {
  let supabase: SupabaseClient;
  let warehouseId: string;
  let supplierId: string;
  const itemIds: string[] = [];
  const variantIds: string[] = [];
  const supplierItemIds: string[] = [];
  const reorderPointIds: string[] = [];

  const createItem = async (name: string) => {
    const { data, error } = await supabase
      .from('items')
      .insert({ tenant_id: TEST_TENANT_ID, name, type: 'product', operation_type: 'sell', price: 10, has_variants: true, is_active: true })
      .select()
      .single();
    if (error) throw error;
    itemIds.push(data.id);
    return data.id;
  };

  const createVariant = async (itemId: string, name: string) => {
    const { data, error } = await supabase
      .from('item_variants')
      .insert({ tenant_id: TEST_TENANT_ID, item_id: itemId, name, is_active: true })
      .select()
      .single();
    if (error) throw error;
    variantIds.push(data.id);
    return data.id;
  };

  const createReorderPoint = async (itemId: string, variantId: string | null, minQty: number, reorderQty: number) => {
    const { data, error } = await supabase
      .from('inventory_reorder_points')
      .insert({
        tenant_id: TEST_TENANT_ID,
        warehouse_id: warehouseId,
        item_id: itemId,
        variant_id: variantId,
        min_quantity: minQty,
        reorder_quantity: reorderQty,
        is_active: true,
      })
      .select()
      .single();
    if (error) throw error;
    reorderPointIds.push(data.id);
    return data.id;
  };

  beforeAll(async () => {
    supabase = createClient(process.env.SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string);
    const { data: wh, error } = await supabase.from('warehouses').select('id').eq('tenant_id', TEST_TENANT_ID).limit(1);
    if (error) throw error;
    warehouseId = wh![0].id;

    const { data: supplier, error: supErr } = await supabase
      .from('suppliers')
      .insert({ tenant_id: TEST_TENANT_ID, name: `SI12 Supplier ${Date.now()}` })
      .select()
      .single();
    if (supErr) throw supErr;
    supplierId = supplier.id;
  }, 30_000);

  afterAll(async () => {
    for (const id of reorderPointIds) await supabase.from('inventory_reorder_points').delete().eq('id', id);
    for (const id of supplierItemIds) await supabase.from('supplier_items').delete().eq('id', id);
    for (const id of variantIds) await supabase.from('item_variants').delete().eq('id', id);
    for (const itemId of itemIds) {
      const { error } = await supabase.from('items').delete().eq('id', itemId);
      if (error) {
        await supabase.from('items').update({ is_active: false, deleted_at: new Date().toISOString() }).eq('id', itemId);
      }
    }
    await supabase.from('suppliers').delete().eq('id', supplierId);
  }, 60_000);

  it('Test 1: create supplier-item configuration — stored correctly', async () => {
    const itemId = await createItem('SI12 Item A');
    const { data, error } = await supabase
      .from('supplier_items')
      .insert({
        tenant_id: TEST_TENANT_ID,
        supplier_id: supplierId,
        item_id: itemId,
        lead_time_days: 5,
        minimum_order_quantity: 20,
        is_preferred: true,
      })
      .select()
      .single();
    expect(error).toBeNull();
    supplierItemIds.push(data.id);
    expect(Number(data.lead_time_days)).toBe(5);
    expect(Number(data.minimum_order_quantity)).toBe(20);
    expect(data.is_preferred).toBe(true);
    expect(data.variant_id).toBeNull();
  }, 30_000);

  it('Test 2: variant-specific configuration overrides item-level configuration', async () => {
    const itemId = await createItem('SI12 Item B (variant override)');
    const variantId = await createVariant(itemId, 'Variant B1');

    const { data: itemLevel } = await supabase
      .from('supplier_items')
      .insert({ tenant_id: TEST_TENANT_ID, supplier_id: supplierId, item_id: itemId, lead_time_days: 10, minimum_order_quantity: 50 })
      .select()
      .single();
    supplierItemIds.push(itemLevel.id);

    const { data: variantLevel } = await supabase
      .from('supplier_items')
      .insert({ tenant_id: TEST_TENANT_ID, supplier_id: supplierId, item_id: itemId, variant_id: variantId, lead_time_days: 3, minimum_order_quantity: 10 })
      .select()
      .single();
    supplierItemIds.push(variantLevel.id);

    const { data: resolvedForVariant, error: err1 } = await supabase.rpc('fn_resolve_supplier_item', {
      p_tenant_id: TEST_TENANT_ID,
      p_item_id: itemId,
      p_variant_id: variantId,
    });
    expect(err1).toBeNull();
    expect(Number(resolvedForVariant.lead_time_days)).toBe(3); // variant-specific wins

    const { data: resolvedForItemOnly, error: err2 } = await supabase.rpc('fn_resolve_supplier_item', {
      p_tenant_id: TEST_TENANT_ID,
      p_item_id: itemId,
      p_variant_id: null,
    });
    expect(err2).toBeNull();
    expect(Number(resolvedForItemOnly.lead_time_days)).toBe(10); // no variant requested -> item-level row
  }, 30_000);

  it('Test 3: purchase suggestions use supplier_items.lead_time_days (first priority tier)', async () => {
    const itemId = await createItem('SI12 Item C (lead time priority)');
    const { data: si } = await supabase
      .from('supplier_items')
      .insert({ tenant_id: TEST_TENANT_ID, supplier_id: supplierId, item_id: itemId, lead_time_days: 2 })
      .select()
      .single();
    supplierItemIds.push(si.id);

    // Reorder point ALSO has its own lead_time_days set — supplier_items must win per approved priority.
    await createReorderPoint(itemId, null, 1000, 50); // min_quantity huge -> always triggers a suggestion
    await supabase.from('inventory_reorder_points').update({ lead_time_days: 99 }).eq('item_id', itemId);

    const { data: suggestions, error } = await supabase.rpc('fn_purchase_suggestions', { p_tenant_id: TEST_TENANT_ID });
    expect(error).toBeNull();
    const row = (suggestions as any[]).find((r) => r.item_id === itemId);
    expect(row).toBeTruthy();
    expect(Number(row.lead_time_days)).toBe(2); // supplier_items wins over reorder_points' own 99
  }, 30_000);

  it('Test 4: purchase suggestions use MOQ correctly (floors the suggested quantity)', async () => {
    const itemId = await createItem('SI12 Item D (MOQ floor)');
    const { data: si } = await supabase
      .from('supplier_items')
      .insert({ tenant_id: TEST_TENANT_ID, supplier_id: supplierId, item_id: itemId, minimum_order_quantity: 500 })
      .select()
      .single();
    supplierItemIds.push(si.id);

    // Small reorder_quantity so MOQ is clearly the binding floor.
    await createReorderPoint(itemId, null, 1000, 1);

    const { data: suggestions, error } = await supabase.rpc('fn_purchase_suggestions', { p_tenant_id: TEST_TENANT_ID });
    expect(error).toBeNull();
    const row = (suggestions as any[]).find((r) => r.item_id === itemId);
    expect(row).toBeTruthy();
    expect(Number(row.minimum_order_quantity)).toBe(500);
    expect(Number(row.suggested_order_quantity)).toBeGreaterThanOrEqual(500); // MOQ floor applied
  }, 30_000);

  it('Test 5: no supplier_items record — existing fallback chain unchanged', async () => {
    const itemId = await createItem('SI12 Item E (no supplier config)');
    await createReorderPoint(itemId, null, 1000, 15);
    // No supplier_items row at all, and no reorder_points.lead_time_days set
    // -> must fall through to fn_supplier_item_lead_time / 7-day default,
    // exactly as before this migration.

    const { data: suggestions, error } = await supabase.rpc('fn_purchase_suggestions', { p_tenant_id: TEST_TENANT_ID });
    expect(error).toBeNull();
    const row = (suggestions as any[]).find((r) => r.item_id === itemId);
    expect(row).toBeTruthy();
    expect(row.minimum_order_quantity).toBeNull(); // no MOQ configured
    expect(Number(row.lead_time_days)).toBe(7); // no history for a brand-new item -> 7-day default, unchanged behavior
  }, 30_000);

  it('Test 6: tenant isolation — supplier_items rows are scoped to tenant_id', async () => {
    const itemId = await createItem('SI12 Item F (tenant isolation)');
    const { data: si, error } = await supabase
      .from('supplier_items')
      .insert({ tenant_id: TEST_TENANT_ID, supplier_id: supplierId, item_id: itemId, lead_time_days: 4 })
      .select()
      .single();
    expect(error).toBeNull();
    supplierItemIds.push(si.id);
    expect(si.tenant_id).toBe(TEST_TENANT_ID);

    const { data: crossTenant } = await supabase
      .from('supplier_items')
      .select('id')
      .eq('id', si.id)
      .eq('tenant_id', '00000000-0000-0000-0000-000000000000');
    expect(crossTenant!.length).toBe(0);
  }, 30_000);
});
