/**
 * Regression suite for Migration 13.10-fix (Barcode Label Printing, #10).
 * Exercises the real ItemBarcodesService class directly against the live
 * Supabase project — same convention as every other regression spec in
 * this directory (e.g. inventory-rules-13.6-fix), used here because the
 * label endpoint's permission gating and 404 behavior live in the
 * application layer (controller/service), not in a DB RPC.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

import 'reflect-metadata';
import { ItemBarcodesService } from '../../../modules/items/item-barcodes.service';
import { ItemBarcodesRepository } from '../../../modules/items/repositories/item-barcodes.repository';
import { ItemsRepository } from '../../../modules/items/repositories/items.repository';
import { ItemBarcodesController } from '../../../modules/items/item-barcodes.controller';
import { REQUIRE_PERMISSION_KEY } from '../../../core/permissions/require-permission.decorator';

const TEST_TENANT_ID = '9bcd3369-d664-47c8-b297-3bc9b429aacf'; // Sefay Demo
const OTHER_TENANT_ID = '00000000-0000-0000-0000-000000000001';

describe('barcode label printing regression (Migration 13.10-fix)', () => {
  let supabase: SupabaseClient;
  let barcodesService: ItemBarcodesService;
  let itemId: string;
  let variantId: string;
  let itemBarcodeId: string;
  let variantBarcodeId: string;

  beforeAll(async () => {
    supabase = createClient(process.env.SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string);

    const barcodesRepo = new ItemBarcodesRepository(supabase);
    const itemsRepo = new ItemsRepository(supabase);
    barcodesService = new ItemBarcodesService(barcodesRepo, itemsRepo);

    const { data: item, error: itemErr } = await supabase
      .from('items')
      .insert({ tenant_id: TEST_TENANT_ID, name: 'Regr Label Item', type: 'product', operation_type: 'sell', price: 5, has_variants: true, is_active: true })
      .select()
      .single();
    if (itemErr) throw itemErr;
    itemId = item.id;

    const { data: variant, error: variantErr } = await supabase
      .from('item_variants')
      .insert({ tenant_id: TEST_TENANT_ID, item_id: itemId, name: 'Regr Label Variant', is_active: true })
      .select()
      .single();
    if (variantErr) throw variantErr;
    variantId = variant.id;

    const { data: itemBarcode, error: ibErr } = await supabase
      .from('item_barcodes')
      .insert({ tenant_id: TEST_TENANT_ID, item_id: itemId, barcode: `13.10FIX-ITEM-${Date.now()}`, barcode_type: 'EAN', is_primary: true })
      .select()
      .single();
    if (ibErr) throw ibErr;
    itemBarcodeId = itemBarcode.id;

    const { data: variantBarcode, error: vbErr } = await supabase
      .from('item_barcodes')
      .insert({ tenant_id: TEST_TENANT_ID, item_id: itemId, variant_id: variantId, barcode: `13.10FIX-VAR-${Date.now()}`, barcode_type: 'QR', is_primary: false })
      .select()
      .single();
    if (vbErr) throw vbErr;
    variantBarcodeId = variantBarcode.id;
  }, 30_000);

  afterAll(async () => {
    await supabase.from('item_barcodes').delete().eq('id', itemBarcodeId);
    await supabase.from('item_barcodes').delete().eq('id', variantBarcodeId);
    await supabase.from('item_variants').delete().eq('id', variantId);
    await supabase.from('items').delete().eq('id', itemId);
  }, 30_000);

  it('Test 1: generates a label for an item-level barcode', async () => {
    const svg = await barcodesService.renderLabel(itemBarcodeId, TEST_TENANT_ID);
    expect(svg).toContain('<svg');
    expect(svg).toContain('Regr Label Item');
    expect(svg).toContain('EAN');
  }, 30_000);

  it('Test 2: generates a label for a variant-level barcode, including the variant name', async () => {
    const svg = await barcodesService.renderLabel(variantBarcodeId, TEST_TENANT_ID);
    expect(svg).toContain('<svg');
    expect(svg).toContain('Regr Label Item');
    expect(svg).toContain('Regr Label Variant');
    expect(svg).toContain('QR');
  }, 30_000);

  it('Test 3: tenant isolation — a barcode from another tenant is not accessible', async () => {
    await expect(barcodesService.renderLabel(itemBarcodeId, OTHER_TENANT_ID)).rejects.toThrow('Barcode not found');
  }, 30_000);

  it('Test 4: invalid/nonexistent barcode id is rejected with 404', async () => {
    await expect(
      barcodesService.renderLabel('00000000-0000-0000-0000-000000000099', TEST_TENANT_ID),
    ).rejects.toThrow('Barcode not found');
  }, 30_000);

  it('Test 5: permission protection — label route requires items.view, same as every other read endpoint on this controller', () => {
    const permission = Reflect.getMetadata(
      REQUIRE_PERMISSION_KEY,
      ItemBarcodesController.prototype.label,
    );
    expect(permission).toBe('items.view');

    // Also reused across guards — @UseGuards on the class covers this handler
    // (JwtAuthGuard, TenantGuard, PermissionGuard), no per-method override exists.
    const classGuards = Reflect.getMetadata('__guards__', ItemBarcodesController);
    expect(classGuards).toBeDefined();
    expect(classGuards.length).toBeGreaterThanOrEqual(3);
  }, 10_000);
});
