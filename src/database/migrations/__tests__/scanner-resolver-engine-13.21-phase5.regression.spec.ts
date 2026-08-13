/**
 * Regression suite for Migration 13.21 Phase 5 — Resolver Engine
 * (item_barcodes / warehouse_locations / item_batches / item_serials /
 * item_rfid_tags identification pipeline). Exercises the real
 * ResolverService directly against the live Supabase project, same
 * convention as every other regression spec in this directory.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

import 'reflect-metadata';
import { ResolverService } from '../../../modules/scanner/resolver/resolver.service';
import { ItemBarcodeResolver } from '../../../modules/scanner/resolver/item-barcode.resolver';
import { LocationResolver } from '../../../modules/scanner/resolver/location.resolver';
import { BatchResolver } from '../../../modules/scanner/resolver/batch.resolver';
import { SerialResolver } from '../../../modules/scanner/resolver/serial.resolver';
import { RfidResolver } from '../../../modules/scanner/resolver/rfid.resolver';
import { ItemBarcodesRepository } from '../../../modules/items/repositories/item-barcodes.repository';
import { LocationsRepository } from '../../../modules/inventory/repositories/locations.repository';
import { SerialsRepository } from '../../../modules/inventory/repositories/serials.repository';
import { BatchesLookupRepository } from '../../../modules/scanner/resolver/repositories/batches-lookup.repository';
import { RfidTagsRepository } from '../../../modules/scanner/resolver/repositories/rfid-tags.repository';
import { normalizeScanValue } from '../../../modules/scanner/utils/normalize-scan-value.util';

const TENANT = '9bcd3369-d664-47c8-b297-3bc9b429aacf'; // Sefay Demo
const OTHER_TENANT = '00000000-0000-0000-0000-000000000001';

describe('Scanner Resolver Engine (Migration 13.21 Phase 5)', () => {
  let supabase: SupabaseClient;
  let resolverService: ResolverService;
  const runSuffix = Date.now();

  let itemId: string;
  let warehouseId: string;
  let locationAId: string;
  let locationBId: string; // same code as A, different warehouse -> ambiguity case
  let batchId: string;
  let serialItemId: string;
  const cleanupItemIds: string[] = [];
  const cleanupLocationIds: string[] = [];
  let batchNumber: string;
  let serialNumber: string;
  let barcode: string;
  let sharedLocationCode: string;
  let secondWarehouseId: string;

  beforeAll(async () => {
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    );

    resolverService = new ResolverService(
      new ItemBarcodeResolver(new ItemBarcodesRepository(supabase)),
      new LocationResolver(new LocationsRepository(supabase)),
      new BatchResolver(new BatchesLookupRepository(supabase)),
      new SerialResolver(new SerialsRepository(supabase)),
      new RfidResolver(new RfidTagsRepository(supabase)),
    );

    const { data: item, error: itemErr } = await supabase
      .from('items')
      .insert({
        tenant_id: TENANT,
        name: 'Resolver Phase5 Item',
        type: 'product',
        operation_type: 'sell',
        price: 5,
        is_active: true,
      })
      .select()
      .single();
    if (itemErr) throw itemErr;
    itemId = item.id;
    cleanupItemIds.push(itemId);

    barcode = `RESV5-${runSuffix}`;
    await supabase.from('item_barcodes').insert({
      tenant_id: TENANT,
      item_id: itemId,
      barcode,
      barcode_type: 'EAN',
      is_primary: true,
    });

    const { data: wh } = await supabase
      .from('warehouses')
      .select('id, branch_id')
      .eq('tenant_id', TENANT)
      .limit(1);
    warehouseId = wh[0].id;

    const { data: wh2, error: wh2Err } = await supabase
      .from('warehouses')
      .insert({
        tenant_id: TENANT,
        branch_id: wh[0].branch_id,
        name: `Resolver Phase5 WH ${runSuffix}`,
        code: `RESV5-WH-${runSuffix}`,
      })
      .select()
      .single();
    if (wh2Err) throw wh2Err;
    secondWarehouseId = wh2.id;

    sharedLocationCode = `RESV5-LOC-${runSuffix}`;
    const { data: locA, error: locAErr } = await supabase
      .from('warehouse_locations')
      .insert({
        tenant_id: TENANT,
        warehouse_id: warehouseId,
        code: sharedLocationCode,
        name: 'Resolver Loc A',
      })
      .select()
      .single();
    if (locAErr) throw locAErr;
    locationAId = locA.id;
    cleanupLocationIds.push(locationAId);

    const { data: locB, error: locBErr } = await supabase
      .from('warehouse_locations')
      .insert({
        tenant_id: TENANT,
        warehouse_id: wh2.id,
        code: sharedLocationCode,
        name: 'Resolver Loc B',
      })
      .select()
      .single();
    if (locBErr) throw locBErr;
    locationBId = locB.id;
    cleanupLocationIds.push(locationBId);

    batchNumber = `RESV5-LOT-${runSuffix}`;
    const { data: batch, error: batchErr } = await supabase
      .from('item_batches')
      .insert({ tenant_id: TENANT, item_id: itemId, batch_number: batchNumber })
      .select()
      .single();
    if (batchErr) throw batchErr;
    batchId = batch.id;

    const { data: serialItem, error: serialItemErr } = await supabase
      .from('items')
      .insert({
        tenant_id: TENANT,
        name: 'Resolver Phase5 Serial Item',
        type: 'product',
        operation_type: 'sell',
        price: 5,
        is_active: true,
        track_serial: true,
      })
      .select()
      .single();
    if (serialItemErr) throw serialItemErr;
    serialItemId = serialItem.id;
    cleanupItemIds.push(serialItemId);

    serialNumber = `RESV5-SN-${runSuffix}`;
    await supabase.from('item_serials').insert({
      tenant_id: TENANT,
      item_id: serialItemId,
      serial_number: serialNumber,
    });
  }, 30_000);

  afterAll(async () => {
    await supabase
      .from('item_serials')
      .delete()
      .eq('tenant_id', TENANT)
      .eq('item_id', serialItemId);
    await supabase.from('item_batches').delete().eq('id', batchId);
    await supabase
      .from('item_barcodes')
      .delete()
      .eq('tenant_id', TENANT)
      .eq('item_id', itemId);
    for (const id of cleanupLocationIds.filter(Boolean)) {
      await supabase
        .from('warehouse_locations')
        .update({ deleted_at: new Date().toISOString(), is_active: false })
        .eq('id', id);
    }
    // The second warehouse has no stock movements referencing it, so a
    // hard delete is safe (unlike warehouse_locations, warehouses itself
    // was never given a soft-deactivate-only convention in this codebase).
    await supabase.from('warehouses').delete().eq('id', secondWarehouseId);
    await supabase.from('items').delete().in('id', cleanupItemIds);
  }, 30_000);

  describe('priority order', () => {
    it('resolves a barcode to entity_type=item via item_barcodes (priority 1)', async () => {
      const result = await resolverService.resolve(
        normalizeScanValue(barcode),
        { tenantId: TENANT },
      );
      expect(result.status).toBe('matched');
      expect(result.entity_type).toBe('item');
      expect(result.entity_id).toBe(itemId);
      expect(result.resolver_source).toBe('item_barcodes');
      expect(result.confidence_score).toBe(1);
    });

    it('resolves a batch_number to entity_type=batch via item_batches (priority 3)', async () => {
      const result = await resolverService.resolve(
        normalizeScanValue(batchNumber),
        { tenantId: TENANT },
      );
      expect(result.status).toBe('matched');
      expect(result.entity_type).toBe('batch');
      expect(result.entity_id).toBe(batchId);
      expect(result.resolver_source).toBe('item_batches');
    });

    it('resolves a serial_number to entity_type=serial via item_serials (priority 4)', async () => {
      const result = await resolverService.resolve(
        normalizeScanValue(serialNumber),
        { tenantId: TENANT },
      );
      expect(result.status).toBe('matched');
      expect(result.entity_type).toBe('serial');
      expect(result.resolver_source).toBe('item_serials');
    });
  });

  describe('location resolution and ambiguity', () => {
    it('reports ambiguous when a location code exists in more than one warehouse with no hint', async () => {
      const result = await resolverService.resolve(
        normalizeScanValue(sharedLocationCode),
        { tenantId: TENANT },
      );
      expect(result.status).toBe('ambiguous');
      expect(result.resolution_metadata.candidate_count).toBe(2);
    });

    it('resolves unambiguously when a warehouse hint is supplied', async () => {
      const result = await resolverService.resolve(
        normalizeScanValue(sharedLocationCode),
        {
          tenantId: TENANT,
          warehouseId,
        },
      );
      expect(result.status).toBe('matched');
      expect(result.entity_type).toBe('location');
      expect(result.entity_id).toBe(locationAId);
      expect(result.resolver_source).toBe('warehouse_locations');
    });
  });

  describe('unknown values', () => {
    it('returns not_found for a value matching nothing', async () => {
      const result = await resolverService.resolve('NO-SUCH-VALUE-EXISTS', {
        tenantId: TENANT,
      });
      expect(result.status).toBe('not_found');
      expect(result.entity_type).toBeNull();
      expect(result.confidence_score).toBe(0);
    });
  });

  describe('tenant isolation', () => {
    it('does not resolve a value that only exists in another tenant', async () => {
      const result = await resolverService.resolve(
        normalizeScanValue(barcode),
        { tenantId: OTHER_TENANT },
      );
      expect(result.status).toBe('not_found');
    });
  });
});
