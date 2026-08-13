/**
 * Regression suite for Migration 13.6-fix (Inventory Rules corrections, #6):
 * (1) fn_create_reservation now excludes quantity_damaged/quantity_expired
 *     from its availability check.
 * (2) TransfersService.create() location<->warehouse validation (already
 *     present, not new — confirmed and locked in here).
 * Runs directly against the real shared Supabase project via the
 * service-role client — same approach as every other regression spec in
 * this directory.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import * as dotenv from 'dotenv';
dotenv.config();

import { TransfersService } from '../../../modules/inventory/transfers.service';
import { TransfersRepository } from '../../../modules/inventory/repositories/transfers.repository';
import { LocationsService } from '../../../modules/inventory/locations.service';
import { LocationsRepository } from '../../../modules/inventory/repositories/locations.repository';
import { WarehousesService } from '../../../modules/inventory/warehouses.service';
import { WarehousesRepository } from '../../../modules/inventory/repositories/warehouses.repository';

const TEST_TENANT_ID = '9bcd3369-d664-47c8-b297-3bc9b429aacf'; // Sefay Demo

describe('inventory rules regression (Migration 13.6-fix)', () => {
  let supabase: SupabaseClient;
  let mainBranchId: string;
  let warehouseId: string;
  let itemId: string;
  const warehouseIds: string[] = [];
  const locationIds: string[] = [];
  const reservationIds: string[] = [];

  const seedStockLevel = async (
    whId: string,
    onHand: number,
    damaged = 0,
    expired = 0,
  ) => {
    const { data, error } = await supabase
      .from('stock_levels')
      .insert({
        tenant_id: TEST_TENANT_ID,
        warehouse_id: whId,
        item_id: itemId,
        quantity_on_hand: onHand,
        quantity_damaged: damaged,
        quantity_expired: expired,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  };

  beforeAll(async () => {
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    );

    const { data: branch, error: branchErr } = await supabase
      .from('branches')
      .select('id')
      .eq('tenant_id', TEST_TENANT_ID)
      .eq('name', 'Main Branch')
      .single();
    if (branchErr) throw branchErr;
    mainBranchId = branch.id;

    const { data: wh, error: whErr } = await supabase
      .from('warehouses')
      .select('id')
      .eq('tenant_id', TEST_TENANT_ID)
      .limit(1)
      .single();
    if (whErr) throw whErr;
    warehouseId = wh.id;

    const { data: item, error: itemErr } = await supabase
      .from('items')
      .insert({
        tenant_id: TEST_TENANT_ID,
        name: 'Regr 13.6-fix Item',
        type: 'product',
        operation_type: 'sell',
        price: 5,
        is_active: true,
      })
      .select()
      .single();
    if (itemErr) throw itemErr;
    itemId = item.id;
  }, 30_000);

  afterAll(async () => {
    for (const id of reservationIds) {
      await supabase.from('stock_reservations').delete().eq('id', id);
    }
    await supabase.from('stock_levels').delete().eq('item_id', itemId);
    await supabase.from('items').delete().eq('id', itemId);
    for (const id of locationIds) {
      await supabase.from('warehouse_locations').delete().eq('id', id);
    }
    for (const id of warehouseIds) {
      const { error } = await supabase.from('warehouses').delete().eq('id', id);
      if (error) {
        await supabase
          .from('warehouses')
          .update({ deleted_at: new Date().toISOString(), is_active: false })
          .eq('id', id);
      }
    }
  }, 60_000);

  describe('Fix 1: reservation availability excludes damaged/expired stock', () => {
    afterEach(async () => {
      // Defensive: a failed assertion above would skip the in-test cleanup and
      // leave a stock_levels row behind, breaking the unique (tenant,warehouse,item)
      // point index for the next test. Clear it unconditionally between tests.
      await supabase
        .from('stock_levels')
        .delete()
        .eq('item_id', itemId)
        .eq('warehouse_id', warehouseId);
    });

    it('Test 1: normal available stock can still be reserved', async () => {
      const level = await seedStockLevel(warehouseId, 20);
      const { data, error } = await supabase.rpc('fn_create_reservation', {
        p_tenant_id: TEST_TENANT_ID,
        p_warehouse_id: warehouseId,
        p_item_id: itemId,
        p_variant_id: null,
        p_batch_id: null,
        p_quantity: 10,
        p_reference_type: 'test_13_6_fix',
        p_reference_id: randomUUID(),
        p_created_by: null,
        p_expires_at: null,
      });
      expect(error).toBeNull();
      expect(data).toBeTruthy();
      reservationIds.push(data.id);
      await supabase.from('stock_levels').delete().eq('id', level.id);
    }, 30_000);

    it('Test 2: reserved quantity reduces availability for subsequent reservations', async () => {
      const level = await seedStockLevel(warehouseId, 10);
      const { data: r1, error: e1 } = await supabase.rpc(
        'fn_create_reservation',
        {
          p_tenant_id: TEST_TENANT_ID,
          p_warehouse_id: warehouseId,
          p_item_id: itemId,
          p_variant_id: null,
          p_batch_id: null,
          p_quantity: 10,
          p_reference_type: 'test_13_6_fix',
          p_reference_id: randomUUID(),
          p_created_by: null,
          p_expires_at: null,
        },
      );
      expect(e1).toBeNull();
      reservationIds.push(r1.id);

      const { error: e2 } = await supabase.rpc('fn_create_reservation', {
        p_tenant_id: TEST_TENANT_ID,
        p_warehouse_id: warehouseId,
        p_item_id: itemId,
        p_variant_id: null,
        p_batch_id: null,
        p_quantity: 1,
        p_reference_type: 'test_13_6_fix',
        p_reference_id: randomUUID(),
        p_created_by: null,
        p_expires_at: null,
      });
      expect(e2).not.toBeNull();
      expect(e2?.message).toContain('INSUFFICIENT_STOCK');

      await supabase.from('stock_levels').delete().eq('id', level.id);
    }, 30_000);

    it('Test 3: damaged quantity cannot be reserved', async () => {
      const level = await seedStockLevel(warehouseId, 10, 10, 0); // all 10 on_hand is damaged
      const { error } = await supabase.rpc('fn_create_reservation', {
        p_tenant_id: TEST_TENANT_ID,
        p_warehouse_id: warehouseId,
        p_item_id: itemId,
        p_variant_id: null,
        p_batch_id: null,
        p_quantity: 1,
        p_reference_type: 'test_13_6_fix',
        p_reference_id: randomUUID(),
        p_created_by: null,
        p_expires_at: null,
      });
      expect(error).not.toBeNull();
      expect(error?.message).toContain('INSUFFICIENT_STOCK');
      await supabase.from('stock_levels').delete().eq('id', level.id);
    }, 30_000);

    it('Test 4: expired quantity cannot be reserved', async () => {
      const level = await seedStockLevel(warehouseId, 10, 0, 10); // all 10 on_hand is expired
      const { error } = await supabase.rpc('fn_create_reservation', {
        p_tenant_id: TEST_TENANT_ID,
        p_warehouse_id: warehouseId,
        p_item_id: itemId,
        p_variant_id: null,
        p_batch_id: null,
        p_quantity: 1,
        p_reference_type: 'test_13_6_fix',
        p_reference_id: randomUUID(),
        p_created_by: null,
        p_expires_at: null,
      });
      expect(error).not.toBeNull();
      expect(error?.message).toContain('INSUFFICIENT_STOCK');
      await supabase.from('stock_levels').delete().eq('id', level.id);
    }, 30_000);

    it('Test 5: partially damaged stock only allows reserving the sellable remainder', async () => {
      const level = await seedStockLevel(warehouseId, 10, 4, 0); // 6 available
      const { error: okErr, data: okData } = await supabase.rpc(
        'fn_create_reservation',
        {
          p_tenant_id: TEST_TENANT_ID,
          p_warehouse_id: warehouseId,
          p_item_id: itemId,
          p_variant_id: null,
          p_batch_id: null,
          p_quantity: 6,
          p_reference_type: 'test_13_6_fix',
          p_reference_id: randomUUID(),
          p_created_by: null,
          p_expires_at: null,
        },
      );
      expect(okErr).toBeNull();
      reservationIds.push(okData.id);

      const { error: overErr } = await supabase.rpc('fn_create_reservation', {
        p_tenant_id: TEST_TENANT_ID,
        p_warehouse_id: warehouseId,
        p_item_id: itemId,
        p_variant_id: null,
        p_batch_id: null,
        p_quantity: 1,
        p_reference_type: 'test_13_6_fix',
        p_reference_id: randomUUID(),
        p_created_by: null,
        p_expires_at: null,
      });
      expect(overErr).not.toBeNull();
      expect(overErr?.message).toContain('INSUFFICIENT_STOCK');

      await supabase.from('stock_levels').delete().eq('id', level.id);
    }, 30_000);
  });

  describe('Fix 2: transfer location <-> warehouse consistency validation (existing behavior, locked in)', () => {
    let whA: string;
    let whB: string;
    let locInA: string;
    let locInB: string;
    let transfersService: TransfersService;

    beforeAll(async () => {
      const { data: a, error: aErr } = await supabase
        .from('warehouses')
        .insert({
          tenant_id: TEST_TENANT_ID,
          branch_id: mainBranchId,
          name: `Regr 13.6-fix WH A ${Date.now()}`,
          code: `R6FA${Date.now() % 100000}`,
        })
        .select()
        .single();
      if (aErr) throw aErr;
      whA = a.id;
      warehouseIds.push(whA);

      const { data: b, error: bErr } = await supabase
        .from('warehouses')
        .insert({
          tenant_id: TEST_TENANT_ID,
          branch_id: mainBranchId,
          name: `Regr 13.6-fix WH B ${Date.now()}`,
          code: `R6FB${Date.now() % 100000}`,
        })
        .select()
        .single();
      if (bErr) throw bErr;
      whB = b.id;
      warehouseIds.push(whB);

      const { data: locA, error: locAErr } = await supabase
        .from('warehouse_locations')
        .insert({
          tenant_id: TEST_TENANT_ID,
          warehouse_id: whA,
          code: `R6F-LOC-A-${Date.now()}`,
          name: 'Loc A',
          location_type: 'zone',
        })
        .select()
        .single();
      if (locAErr) throw locAErr;
      locInA = locA.id;
      locationIds.push(locInA);

      const { data: locB, error: locBErr } = await supabase
        .from('warehouse_locations')
        .insert({
          tenant_id: TEST_TENANT_ID,
          warehouse_id: whB,
          code: `R6F-LOC-B-${Date.now()}`,
          name: 'Loc B',
          location_type: 'zone',
        })
        .select()
        .single();
      if (locBErr) throw locBErr;
      locInB = locB.id;
      locationIds.push(locInB);

      const warehousesRepo = new WarehousesRepository(supabase);
      const warehousesService = new WarehousesService(warehousesRepo);
      const locationsRepo = new LocationsRepository(supabase);
      const locationsService = new LocationsService(
        locationsRepo,
        warehousesService,
      );
      const transfersRepo = new TransfersRepository(supabase);
      // create() never touches stockService — a stub is sufficient here.
      const stubStockService = {} as never;
      transfersService = new TransfersService(
        transfersRepo,
        locationsService,
        stubStockService,
      );
    }, 30_000);

    it('Test 1: valid warehouse/location transfer succeeds', async () => {
      const result = await transfersService.create(TEST_TENANT_ID, {
        from_warehouse_id: whA,
        to_warehouse_id: whB,
        transfer_number: `R6F-VALID-${Date.now()}`,
        items: [
          {
            item_id: itemId,
            quantity: 1,
            from_location_id: locInA,
            to_location_id: locInB,
          },
        ],
      });
      expect(result).toBeTruthy();
      await supabase
        .from('stock_transfer_items')
        .delete()
        .eq('stock_transfer_id', (result as { id: string }).id);
      await supabase
        .from('stock_transfers')
        .delete()
        .eq('id', (result as { id: string }).id);
    }, 30_000);

    it('Test 2: invalid source location (belongs to a different warehouse) is rejected', async () => {
      await expect(
        transfersService.create(TEST_TENANT_ID, {
          from_warehouse_id: whA,
          to_warehouse_id: whB,
          transfer_number: `R6F-BADSRC-${Date.now()}`,
          items: [
            {
              item_id: itemId,
              quantity: 1,
              from_location_id: locInB, // wrong: belongs to whB, not whA
              to_location_id: locInB,
            },
          ],
        }),
      ).rejects.toThrow('Location not found');
    }, 30_000);

    it('Test 3: invalid destination location (belongs to a different warehouse) is rejected', async () => {
      await expect(
        transfersService.create(TEST_TENANT_ID, {
          from_warehouse_id: whA,
          to_warehouse_id: whB,
          transfer_number: `R6F-BADDST-${Date.now()}`,
          items: [
            {
              item_id: itemId,
              quantity: 1,
              from_location_id: locInA,
              to_location_id: locInA, // wrong: belongs to whA, not whB
            },
          ],
        }),
      ).rejects.toThrow('Location not found');
    }, 30_000);
  });
});
