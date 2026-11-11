// Inventory Stage 1 / Item #2 (Owner-approved, narrow scope) — regression
// coverage for migration 221: structured item attributes + multi-level
// packaging (Piece/Box/Carton/Pallet) resolved into the item's existing
// storage-unit quantity, never a second stock truth.
import 'dotenv/config';
import { requireTestTenantId } from '../../../../test/support/test-tenant';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

describe('item attributes + packaging levels (Migration 221)', () => {
  let supabase: SupabaseClient;
  let tenantId: string;
  let itemId: string;
  let colorAttrId: string;
  let redValueId: string;
  let variantId: string;
  let pieceLevelId: string;
  let boxLevelId: string;
  let cartonLevelId: string;
  let palletLevelId: string;

  beforeAll(async () => {
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    );

    tenantId = requireTestTenantId();

    const { data: item } = await supabase
      .from('items')
      .insert({
        tenant_id: tenantId,
        name: 'QA Item#2 Packaging Test Item',
        type: 'product',
        operation_type: 'sell',
        price: 10,
        has_inventory: true,
        has_variants: true,
      })
      .select('id')
      .single();
    itemId = item.id;

    const { data: variant } = await supabase
      .from('item_variants')
      .insert({ item_id: itemId, tenant_id: tenantId, name: 'Red' })
      .select('id')
      .single();
    variantId = variant.id;
  });

  afterAll(async () => {
    await supabase.from('item_barcodes').delete().eq('item_id', itemId);
    await supabase.from('item_packaging_levels').delete().eq('item_id', itemId);
    await supabase
      .from('item_variant_attribute_values')
      .delete()
      .eq('item_variant_id', variantId);
    if (colorAttrId) {
      await supabase.from('item_attribute_values').delete().eq('item_attribute_id', colorAttrId);
      await supabase.from('item_attributes').delete().eq('id', colorAttrId);
    }
    await supabase.from('item_variants').delete().eq('id', variantId);
    await supabase.from('items').delete().eq('id', itemId);
  });

  it('Test 1: attribute definition + value + variant assignment', async () => {
    const { data: attr, error: attrError } = await supabase
      .from('item_attributes')
      .insert({ tenant_id: tenantId, name: 'QA Color' })
      .select('id')
      .single();
    expect(attrError).toBeNull();
    colorAttrId = attr.id;

    const { data: value, error: valueError } = await supabase
      .from('item_attribute_values')
      .insert({ tenant_id: tenantId, item_attribute_id: colorAttrId, value: 'Red' })
      .select('id')
      .single();
    expect(valueError).toBeNull();
    redValueId = value.id;

    const { error: assignError } = await supabase
      .from('item_variant_attribute_values')
      .insert({
        tenant_id: tenantId,
        item_variant_id: variantId,
        item_attribute_id: colorAttrId,
        item_attribute_value_id: redValueId,
      });
    expect(assignError).toBeNull();
  });

  it('Test 2: a variant cannot have two values for the same attribute', async () => {
    const { data: blueValue } = await supabase
      .from('item_attribute_values')
      .insert({ tenant_id: tenantId, item_attribute_id: colorAttrId, value: 'Blue' })
      .select('id')
      .single();

    const { error } = await supabase.from('item_variant_attribute_values').insert({
      tenant_id: tenantId,
      item_variant_id: variantId,
      item_attribute_id: colorAttrId,
      item_attribute_value_id: blueValue.id,
    });
    expect(error).not.toBeNull(); // uq_variant_attribute violated

    await supabase.from('item_attribute_values').delete().eq('id', blueValue.id);
  });

  it('Test 3: packaging hierarchy — Piece (root) -> Box(24) -> Carton(12) -> Pallet(10)', async () => {
    const { data: piece } = await supabase
      .from('item_packaging_levels')
      .insert({ tenant_id: tenantId, item_id: itemId, level_name: 'Piece', parent_level_id: null, quantity_in_parent: 1 })
      .select('id')
      .single();
    pieceLevelId = piece.id;

    const { data: box } = await supabase
      .from('item_packaging_levels')
      .insert({ tenant_id: tenantId, item_id: itemId, level_name: 'Box', parent_level_id: pieceLevelId, quantity_in_parent: 24 })
      .select('id')
      .single();
    boxLevelId = box.id;

    const { data: carton } = await supabase
      .from('item_packaging_levels')
      .insert({ tenant_id: tenantId, item_id: itemId, level_name: 'Carton', parent_level_id: boxLevelId, quantity_in_parent: 12 })
      .select('id')
      .single();
    cartonLevelId = carton.id;

    const { data: pallet } = await supabase
      .from('item_packaging_levels')
      .insert({ tenant_id: tenantId, item_id: itemId, level_name: 'Pallet', parent_level_id: cartonLevelId, quantity_in_parent: 10 })
      .select('id')
      .single();
    palletLevelId = pallet.id;

    expect(pieceLevelId && boxLevelId && cartonLevelId && palletLevelId).toBeTruthy();
  });

  it('Test 4: only one root level per item is allowed', async () => {
    const { error } = await supabase
      .from('item_packaging_levels')
      .insert({ tenant_id: tenantId, item_id: itemId, level_name: 'AltRoot', parent_level_id: null, quantity_in_parent: 1 });
    expect(error).not.toBeNull(); // uq_item_packaging_root violated
  });

  it('Test 5: fn_convert_packaging_to_storage_qty resolves each level to the correct storage-unit (Piece) quantity', async () => {
    const cases: [string, number, number][] = [
      [pieceLevelId, 1, 1],
      [boxLevelId, 1, 24],
      [cartonLevelId, 1, 24 * 12],
      [palletLevelId, 1, 24 * 12 * 10],
      [palletLevelId, 3, 3 * 24 * 12 * 10],
    ];

    for (const [levelId, qty, expected] of cases) {
      const { data, error } = await supabase.rpc('fn_convert_packaging_to_storage_qty', {
        p_item_id: itemId,
        p_packaging_level_id: levelId,
        p_quantity: qty,
      });
      expect(error).toBeNull();
      expect(Number(data)).toBe(expected);
    }
  });

  it('Test 6: NULL packaging level is a no-op passthrough (existing barcode behavior preserved)', async () => {
    const { data, error } = await supabase.rpc('fn_convert_packaging_to_storage_qty', {
      p_item_id: itemId,
      p_packaging_level_id: null,
      p_quantity: 5,
    });
    expect(error).toBeNull();
    expect(Number(data)).toBe(5);
  });

  it('Test 7: a packaging level belonging to a different item is rejected, not silently guessed', async () => {
    const { data: otherItem } = await supabase
      .from('items')
      .insert({
        tenant_id: tenantId,
        name: 'QA Item#2 Other Item',
        type: 'product',
        operation_type: 'sell',
        price: 5,
        has_inventory: true,
      })
      .select('id')
      .single();

    const { error } = await supabase.rpc('fn_convert_packaging_to_storage_qty', {
      p_item_id: otherItem.id,
      p_packaging_level_id: cartonLevelId,
      p_quantity: 1,
    });
    expect(error).not.toBeNull();
    expect(error.message).toMatch(/not configured for item/);

    await supabase.from('items').delete().eq('id', otherItem.id);
  });

  it('Test 8: assigning a barcode to a packaging level does not disturb existing unit/variant barcodes', async () => {
    const { data: unitBarcode, error: unitError } = await supabase
      .from('item_barcodes')
      .insert({ tenant_id: tenantId, item_id: itemId, variant_id: variantId, barcode: `QA-UNIT-${Date.now()}`, barcode_type: 'UPC' })
      .select('id, packaging_level_id')
      .single();
    expect(unitError).toBeNull();
    expect(unitBarcode.packaging_level_id).toBeNull();

    const { data: cartonBarcode, error: cartonError } = await supabase
      .from('item_barcodes')
      .insert({
        tenant_id: tenantId,
        item_id: itemId,
        barcode: `QA-CARTON-${Date.now()}`,
        barcode_type: 'GS1',
        packaging_level_id: cartonLevelId,
      })
      .select('id, packaging_level_id')
      .single();
    expect(cartonError).toBeNull();
    expect(cartonBarcode.packaging_level_id).toBe(cartonLevelId);

    // Resolve the carton barcode's quantity-equivalent the same way a
    // receive/sell/transfer/count flow would: look up its
    // packaging_level_id, then convert.
    const { data: resolvedQty, error: resolveError } = await supabase.rpc(
      'fn_convert_packaging_to_storage_qty',
      { p_item_id: itemId, p_packaging_level_id: cartonBarcode.packaging_level_id, p_quantity: 1 },
    );
    expect(resolveError).toBeNull();
    expect(Number(resolvedQty)).toBe(24 * 12); // 1 Carton = 288 Pieces
  });

  it('Test 9: cascading delete — removing a mid-chain packaging level removes its children (no orphaned levels)', async () => {
    // Deleting Box should cascade to Carton and Pallet (both descend from it).
    await supabase.from('item_packaging_levels').delete().eq('id', boxLevelId);

    const { data: remaining } = await supabase
      .from('item_packaging_levels')
      .select('id, level_name')
      .eq('item_id', itemId);

    const remainingNames = remaining.map((r: { level_name: string }) => r.level_name);
    expect(remainingNames).toEqual(['Piece']);
  });
});
