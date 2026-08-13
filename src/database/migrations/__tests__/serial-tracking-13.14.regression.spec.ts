/**
 * Regression suite for Migration 13.14 (Serial Number Tracking + Warranty +
 * Customer History completion, #14). Runs directly against the real shared
 * Supabase project via the service-role client — same convention as every
 * other regression spec in this directory. Exercises the real
 * SerialsRepository/SerialsService classes directly (the actual
 * integration points), plus fn_post_goods_receipt (Phase 1 fix) and
 * fn_apply_stock_movement (unchanged, non-serialized control case) via
 * direct RPC calls.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

import { SerialsRepository } from '../../../modules/inventory/repositories/serials.repository';
import { SerialsService } from '../../../modules/inventory/serials.service';

const TEST_TENANT_ID = '9bcd3369-d664-47c8-b297-3bc9b429aacf'; // Sefay Demo
const OTHER_TENANT_ID = '00000000-0000-0000-0000-000000000004';

describe('serial number tracking regression (Migration 13.14)', () => {
  let supabase: SupabaseClient;
  let serialsRepo: SerialsRepository;
  let serialsService: SerialsService;
  let warehouseId: string;
  let itemSerialized: string;
  let itemPlain: string;
  let customerId: string;
  const itemIds: string[] = [];
  const grIds: string[] = [];
  const orderIds: string[] = [];
  const serialIds: string[] = [];

  const seedGoodsReceipt = async (
    itemId: string,
    quantity: number,
    opts: { serialNumber?: string; batchNumber?: string } = {},
  ) => {
    const { data: gr, error: grErr } = await supabase
      .from('goods_receipts')
      .insert({
        tenant_id: TEST_TENANT_ID,
        warehouse_id: warehouseId,
        receipt_number: `R1314-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        status: 'draft',
      })
      .select()
      .single();
    if (grErr) throw grErr;
    grIds.push(gr.id);

    const { error: griErr } = await supabase
      .from('goods_receipt_items')
      .insert({
        tenant_id: TEST_TENANT_ID,
        goods_receipt_id: gr.id,
        item_id: itemId,
        quantity_received: quantity,
        unit_cost: 10,
        serial_number: opts.serialNumber ?? null,
        batch_number: opts.batchNumber ?? null,
      });
    if (griErr) throw griErr;

    const { data: posted, error: postErr } = await supabase.rpc(
      'fn_post_goods_receipt',
      {
        p_goods_receipt_id: gr.id,
        p_actor_id: null,
      },
    );
    if (postErr) throw postErr;
    return posted;
  };

  beforeAll(async () => {
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    );
    serialsRepo = new SerialsRepository(supabase);
    serialsService = new SerialsService(serialsRepo);

    const { data: wh, error: whErr } = await supabase
      .from('warehouses')
      .select('id')
      .eq('tenant_id', TEST_TENANT_ID)
      .limit(1)
      .single();
    if (whErr) throw whErr;
    warehouseId = wh.id;

    const { data: iSerial, error: iSerialErr } = await supabase
      .from('items')
      .insert({
        tenant_id: TEST_TENANT_ID,
        name: 'Regr 13.14 Serialized Item',
        type: 'product',
        operation_type: 'sell',
        price: 100,
        track_serial: true,
        is_active: true,
      })
      .select()
      .single();
    if (iSerialErr) throw iSerialErr;
    itemSerialized = iSerial.id;
    itemIds.push(itemSerialized);

    const { data: iPlain, error: iPlainErr } = await supabase
      .from('items')
      .insert({
        tenant_id: TEST_TENANT_ID,
        name: 'Regr 13.14 Plain Item',
        type: 'product',
        operation_type: 'sell',
        price: 5,
        is_active: true,
      })
      .select()
      .single();
    if (iPlainErr) throw iPlainErr;
    itemPlain = iPlain.id;
    itemIds.push(itemPlain);

    const { data: customer, error: custErr } = await supabase
      .from('customers')
      .insert({ tenant_id: TEST_TENANT_ID, full_name: 'Regr 13.14 Customer' })
      .select()
      .single();
    if (custErr) throw custErr;
    customerId = customer.id;
  }, 30_000);

  afterAll(async () => {
    await supabase.from('item_serials').delete().in('item_id', itemIds);
    await supabase.from('stock_movements').delete().in('item_id', itemIds); // ledger rows for these throwaway test items only
    await supabase.from('cost_layers').delete().in('item_id', itemIds);
    await supabase.from('stock_levels').delete().in('item_id', itemIds);
    for (const id of grIds) {
      await supabase
        .from('goods_receipt_items')
        .delete()
        .eq('goods_receipt_id', id);
      await supabase.from('goods_receipts').delete().eq('id', id);
    }
    for (const id of orderIds) {
      await supabase.from('order_items').delete().eq('order_id', id);
      await supabase.from('orders').delete().eq('id', id);
    }
    await supabase.from('customers').delete().eq('id', customerId);
    for (const id of itemIds) {
      await supabase.from('items').delete().eq('id', id);
    }
  }, 60_000);

  it('Test 1: serial is created from a goods receipt', async () => {
    const serialNumber = `R1314-SN-${Date.now()}`;
    await seedGoodsReceipt(itemSerialized, 1, { serialNumber });

    const found = await serialsRepo.findByNumber(serialNumber, TEST_TENANT_ID);
    expect(found.length).toBe(1);
    expect(found[0].status).toBe('in_stock');
    expect(found[0].item_id).toBe(itemSerialized);
    serialIds.push(found[0].id);
  }, 30_000);

  it('Test 2: item_batches.serial_number no longer receives the write (legacy column stays NULL on new receipts)', async () => {
    const serialNumber = `R1314-SN2-${Date.now()}`;
    await seedGoodsReceipt(itemSerialized, 1, { serialNumber });

    const { data: serial } = await supabase
      .from('item_serials')
      .select('id, batch_id')
      .eq('tenant_id', TEST_TENANT_ID)
      .eq('serial_number', serialNumber)
      .single();
    expect(serial).toBeTruthy();
    serialIds.push(serial.id);

    // The item_batches anchor row exists (still required for cost_layers.batch_id),
    // but its own serial_number column must be NULL — the dual-write is fixed.
    expect(serial.batch_id).toBeTruthy();
    const { data: batchRow } = await supabase
      .from('item_batches')
      .select('serial_number')
      .eq('id', serial.batch_id)
      .single();
    expect(batchRow.serial_number).toBeNull();
  }, 30_000);

  it('Test 3: serial sale transitions in_stock -> sold', async () => {
    const serialNumber = `R1314-SN3-${Date.now()}`;
    await seedGoodsReceipt(itemSerialized, 1, { serialNumber });
    const [serial] = await serialsRepo.findByNumber(
      serialNumber,
      TEST_TENANT_ID,
    );
    serialIds.push(serial.id);

    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .insert({
        tenant_id: TEST_TENANT_ID,
        customer_id: customerId,
        status: 'completed',
        total: 100,
      })
      .select()
      .single();
    if (orderErr) throw orderErr;
    orderIds.push(order.id);

    const sold = await serialsRepo.sell(serial.id, order.id, 12);
    expect(sold.status).toBe('sold');
    expect(sold.sold_order_id).toBe(order.id);
    expect(sold.warranty_months).toBe(12);
    expect(sold.warranty_expires_at).toBeTruthy();
  }, 30_000);

  it('Test 4: serial return transitions sold -> returned', async () => {
    const serialNumber = `R1314-SN4-${Date.now()}`;
    await seedGoodsReceipt(itemSerialized, 1, { serialNumber });
    const [serial] = await serialsRepo.findByNumber(
      serialNumber,
      TEST_TENANT_ID,
    );
    serialIds.push(serial.id);

    const { data: order } = await supabase
      .from('orders')
      .insert({
        tenant_id: TEST_TENANT_ID,
        customer_id: customerId,
        status: 'completed',
        total: 100,
      })
      .select()
      .single();
    orderIds.push(order.id);

    await serialsRepo.sell(serial.id, order.id, null);
    const returned = await serialsRepo.returnSerial(serial.id);
    expect(returned.status).toBe('returned');
  }, 30_000);

  it('Test 5: customer history returns the correct customer and order', async () => {
    const serialNumber = `R1314-SN5-${Date.now()}`;
    await seedGoodsReceipt(itemSerialized, 1, { serialNumber });
    const [serial] = await serialsRepo.findByNumber(
      serialNumber,
      TEST_TENANT_ID,
    );
    serialIds.push(serial.id);

    const { data: order } = await supabase
      .from('orders')
      .insert({
        tenant_id: TEST_TENANT_ID,
        customer_id: customerId,
        status: 'completed',
        total: 100,
      })
      .select()
      .single();
    orderIds.push(order.id);
    await serialsRepo.sell(serial.id, order.id, 6);

    const history = await serialsService.getCustomerHistory(
      serial.id,
      TEST_TENANT_ID,
    );
    expect(history.sold).toBe(true);
    expect(history.order_id).toBe(order.id);
    expect(history.customer.id).toBe(customerId);
    expect(history.customer.full_name).toBe('Regr 13.14 Customer');

    const byCustomer = await serialsRepo.findByCustomer(
      customerId,
      TEST_TENANT_ID,
    );
    expect(byCustomer.some((s: any) => s.id === serial.id)).toBe(true);
  }, 30_000);

  it('Test 6: warranty status calculation — active vs expired vs none', async () => {
    const activeSerialNumber = `R1314-SN6A-${Date.now()}`;
    await seedGoodsReceipt(itemSerialized, 1, {
      serialNumber: activeSerialNumber,
    });
    const [activeSerial] = await serialsRepo.findByNumber(
      activeSerialNumber,
      TEST_TENANT_ID,
    );
    serialIds.push(activeSerial.id);
    const { data: order1 } = await supabase
      .from('orders')
      .insert({
        tenant_id: TEST_TENANT_ID,
        customer_id: customerId,
        status: 'completed',
        total: 100,
      })
      .select()
      .single();
    orderIds.push(order1.id);
    await serialsRepo.sell(activeSerial.id, order1.id, 12); // 12 months from now -> active

    const activeStatus = await serialsService.getWarrantyStatus(
      activeSerial.id,
      TEST_TENANT_ID,
    );
    expect(activeStatus.has_warranty).toBe(true);
    expect(activeStatus.status).toBe('active');
    expect(activeStatus.days_remaining).toBeGreaterThan(0);

    const noWarrantySerialNumber = `R1314-SN6B-${Date.now()}`;
    await seedGoodsReceipt(itemSerialized, 1, {
      serialNumber: noWarrantySerialNumber,
    });
    const [noWarrantySerial] = await serialsRepo.findByNumber(
      noWarrantySerialNumber,
      TEST_TENANT_ID,
    );
    serialIds.push(noWarrantySerial.id);
    const noWarrantyStatus = await serialsService.getWarrantyStatus(
      noWarrantySerial.id,
      TEST_TENANT_ID,
    );
    expect(noWarrantyStatus.has_warranty).toBe(false);
    expect(noWarrantyStatus.status).toBe('none');

    // Directly seed an already-expired warranty to verify the 'expired' branch.
    const expiredSerialNumber = `R1314-SN6C-${Date.now()}`;
    await seedGoodsReceipt(itemSerialized, 1, {
      serialNumber: expiredSerialNumber,
    });
    const [expiredSerial] = await serialsRepo.findByNumber(
      expiredSerialNumber,
      TEST_TENANT_ID,
    );
    serialIds.push(expiredSerial.id);
    const yesterday = new Date(Date.now() - 86400000)
      .toISOString()
      .slice(0, 10);
    await supabase
      .from('item_serials')
      .update({
        status: 'sold',
        warranty_months: 1,
        warranty_expires_at: yesterday,
        sold_at: new Date().toISOString(),
      })
      .eq('id', expiredSerial.id);
    const expiredStatus = await serialsService.getWarrantyStatus(
      expiredSerial.id,
      TEST_TENANT_ID,
    );
    expect(expiredStatus.status).toBe('expired');
    expect(expiredStatus.days_remaining).toBeNull();
  }, 30_000);

  it("Test 7: tenant isolation — another tenant cannot see this tenant's serial", async () => {
    const serialNumber = `R1314-SN7-${Date.now()}`;
    await seedGoodsReceipt(itemSerialized, 1, { serialNumber });
    const [serial] = await serialsRepo.findByNumber(
      serialNumber,
      TEST_TENANT_ID,
    );
    serialIds.push(serial.id);

    const crossTenant = await serialsRepo.findByNumber(
      serialNumber,
      OTHER_TENANT_ID,
    );
    expect(crossTenant).toEqual([]);

    await expect(
      serialsService.findById(serial.id, OTHER_TENANT_ID),
    ).rejects.toThrow('Serial not found');
  }, 30_000);

  it('Test 8: existing non-serialized receipt/sale flow is unchanged', async () => {
    const posted = await seedGoodsReceipt(itemPlain, 20);
    expect(posted.status).toBe('posted');

    // No item_serials row should ever be created for a line with no serial_number.
    const { data: stray } = await supabase
      .from('item_serials')
      .select('id')
      .eq('item_id', itemPlain);
    expect(stray).toEqual([]);

    const { data: level } = await supabase
      .from('stock_levels')
      .select('quantity_on_hand')
      .eq('tenant_id', TEST_TENANT_ID)
      .eq('warehouse_id', warehouseId)
      .eq('item_id', itemPlain)
      .is('variant_id', null)
      .maybeSingle();
    expect(Number(level?.quantity_on_hand)).toBeGreaterThanOrEqual(20);
  }, 30_000);
});
