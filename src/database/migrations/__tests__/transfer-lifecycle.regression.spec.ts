/**
 * Regression suite for migrations 117-119 (transfer lifecycle + intra-warehouse
 * transfers + the goods-receipt location fix). Runs directly against the real
 * shared Supabase project via the service-role client — there is no isolated
 * test database in this environment (see STATUS.md staging/production sharing
 * note). Every fixture created here is tenant-scoped and torn down in
 * afterAll; nothing here is wired into CI (api.yml only runs `npm run build`)
 * — run deliberately via `npm test` when touching this area again.
 *
 * Exists specifically so the two real bugs found live on 2026-07-25 can never
 * silently come back: (1) chk_transfer_different_warehouses blocking
 * legitimate same-warehouse location/shelf moves, and (2)
 * fn_post_goods_receipt hardcoding NULL instead of the line's location_id.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const TEST_TENANT_ID = '9bcd3369-d664-47c8-b297-3bc9b429aacf'; // Sefay Demo — used throughout this session's live verifications

describe('transfer lifecycle regression (migrations 117-119)', () => {
  let supabase: SupabaseClient;
  let warehouseId: string;
  let itemId: string;
  const cleanup: { table: string; id: string }[] = [];

  const seedStock = async (
    whId: string,
    qty: number,
    locationId: string | null = null,
  ) => {
    const { data: gr } = await supabase
      .from('goods_receipts')
      .insert({
        tenant_id: TEST_TENANT_ID,
        warehouse_id: whId,
        receipt_number: `REGR-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        status: 'draft',
      })
      .select()
      .single();
    await supabase.from('goods_receipt_items').insert({
      tenant_id: TEST_TENANT_ID,
      goods_receipt_id: gr.id,
      item_id: itemId,
      quantity_received: qty,
      unit_cost: 3,
      location_id: locationId,
    });
    const { data: posted, error } = await supabase.rpc(
      'fn_post_goods_receipt',
      { p_goods_receipt_id: gr.id, p_actor_id: null },
    );
    cleanup.push({ table: 'goods_receipts', id: gr.id });
    if (error) throw error;
    return posted;
  };

  const runTransferCycle = async (transferId: string) => {
    await supabase.rpc('fn_transfer_approve', {
      p_transfer_id: transferId,
      p_actor_id: null,
    });
    const dispatch = await supabase.rpc('fn_transfer_dispatch', {
      p_transfer_id: transferId,
      p_actor_id: null,
    });
    const receive = await supabase.rpc('fn_transfer_receive', {
      p_transfer_id: transferId,
      p_actor_id: null,
    });
    return { dispatchError: dispatch.error, receiveError: receive.error };
  };

  const balanceAt = async (locationId: string | null) => {
    let q = supabase
      .from('v_stock_balance')
      .select('quantity_on_hand')
      .eq('item_id', itemId);
    q =
      locationId === null
        ? q.is('location_id', null)
        : q.eq('location_id', locationId);
    const { data } = await q.maybeSingle();
    return data ? Number(data.quantity_on_hand) : 0;
  };

  const totalOnHand = async () => {
    const { data } = await supabase
      .from('v_stock_balance')
      .select('quantity_on_hand')
      .eq('item_id', itemId);
    return (data ?? []).reduce((s, r) => s + Number(r.quantity_on_hand), 0);
  };

  const totalValuation = async () => {
    const { data } = await supabase
      .from('cost_layers')
      .select('quantity_remaining, unit_cost')
      .eq('item_id', itemId);
    return (data ?? []).reduce(
      (s, r) => s + Number(r.quantity_remaining) * Number(r.unit_cost),
      0,
    );
  };

  beforeAll(async () => {
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    );

    const { data: wh } = await supabase
      .from('warehouses')
      .select('id')
      .eq('tenant_id', TEST_TENANT_ID)
      .limit(1);
    warehouseId = wh[0].id;

    const { data: item } = await supabase
      .from('items')
      .insert({
        tenant_id: TEST_TENANT_ID,
        name: 'Regression Suite Item',
        type: 'product',
        operation_type: 'sell',
        price: 5,
        is_active: true,
      })
      .select()
      .single();
    itemId = item.id;
  }, 30_000);

  afterAll(async () => {
    await supabase.from('cost_layers').delete().eq('item_id', itemId);
    await supabase.from('stock_levels').delete().eq('item_id', itemId);
    for (const c of cleanup) {
      await supabase
        .from('goods_receipt_items')
        .delete()
        .eq('goods_receipt_id', c.id);
      await supabase.from(c.table).delete().eq('id', c.id);
    }
    await supabase.from('items').delete().eq('id', itemId);
    // stock_movements rows are intentionally left — DB trigger makes the
    // ledger immutable (documented project-wide, not a leak).
  }, 30_000);

  it('goods receipt honors an explicit location_id (regression for migration 111->119)', async () => {
    const { data: loc } = await supabase
      .from('warehouse_locations')
      .insert({
        tenant_id: TEST_TENANT_ID,
        warehouse_id: warehouseId,
        code: `REGR-LOC-${Date.now()}`,
        name: 'Regression Location',
        location_type: 'zone',
      })
      .select()
      .single();

    await seedStock(warehouseId, 20, loc.id);

    expect(await balanceAt(loc.id)).toBe(20);
    expect(await balanceAt(null)).toBe(0); // must NOT have silently landed at warehouse level

    await supabase.from('warehouse_locations').delete().eq('id', loc.id);
  }, 30_000);

  it('warehouse -> warehouse transfer still works unchanged', async () => {
    const { data: whB } = await supabase
      .from('warehouses')
      .insert({
        tenant_id: TEST_TENANT_ID,
        name: `Regr WH B ${Date.now()}`,
        code: `RWB${Date.now() % 100000}`,
      })
      .select()
      .single();

    await seedStock(warehouseId, 30);
    const before = { qty: await totalOnHand(), value: await totalValuation() };

    const { data: transfer } = await supabase
      .from('stock_transfers')
      .insert({
        tenant_id: TEST_TENANT_ID,
        from_warehouse_id: warehouseId,
        to_warehouse_id: whB.id,
        transfer_number: `REGR-WH2WH-${Date.now()}`,
        status: 'draft',
      })
      .select()
      .single();
    await supabase.from('stock_transfer_items').insert({
      tenant_id: TEST_TENANT_ID,
      stock_transfer_id: transfer.id,
      item_id: itemId,
      quantity: 10,
    });

    const { dispatchError, receiveError } = await runTransferCycle(transfer.id);
    expect(dispatchError).toBeNull();
    expect(receiveError).toBeNull();
    expect(await totalOnHand()).toBe(before.qty);
    expect(await totalValuation()).toBe(before.value);

    await supabase
      .from('stock_transfer_items')
      .delete()
      .eq('stock_transfer_id', transfer.id);
    await supabase.from('stock_transfers').delete().eq('id', transfer.id);
    await supabase.from('warehouses').delete().eq('id', whB.id);
  }, 30_000);

  it('location -> location transfer within the same warehouse succeeds', async () => {
    const { data: locA } = await supabase
      .from('warehouse_locations')
      .insert({
        tenant_id: TEST_TENANT_ID,
        warehouse_id: warehouseId,
        code: `REGR-A-${Date.now()}`,
        name: 'Loc A',
        location_type: 'zone',
      })
      .select()
      .single();
    const { data: locB } = await supabase
      .from('warehouse_locations')
      .insert({
        tenant_id: TEST_TENANT_ID,
        warehouse_id: warehouseId,
        code: `REGR-B-${Date.now()}`,
        name: 'Loc B',
        location_type: 'zone',
      })
      .select()
      .single();

    await seedStock(warehouseId, 25, locA.id);
    const before = { qty: await totalOnHand(), value: await totalValuation() };

    const { data: transfer } = await supabase
      .from('stock_transfers')
      .insert({
        tenant_id: TEST_TENANT_ID,
        from_warehouse_id: warehouseId,
        to_warehouse_id: warehouseId,
        transfer_number: `REGR-LOC2LOC-${Date.now()}`,
        status: 'draft',
      })
      .select()
      .single();
    await supabase.from('stock_transfer_items').insert({
      tenant_id: TEST_TENANT_ID,
      stock_transfer_id: transfer.id,
      item_id: itemId,
      quantity: 10,
      from_location_id: locA.id,
      to_location_id: locB.id,
    });

    const { dispatchError, receiveError } = await runTransferCycle(transfer.id);
    expect(dispatchError).toBeNull();
    expect(receiveError).toBeNull();
    expect(await balanceAt(locA.id)).toBe(15);
    expect(await balanceAt(locB.id)).toBe(10);
    expect(await totalOnHand()).toBe(before.qty); // nothing entered/left the warehouse
    expect(await totalValuation()).toBe(before.value); // reshuffled, not revalued

    await supabase
      .from('stock_transfer_items')
      .delete()
      .eq('stock_transfer_id', transfer.id);
    await supabase.from('stock_transfers').delete().eq('id', transfer.id);
    await supabase
      .from('warehouse_locations')
      .delete()
      .in('id', [locA.id, locB.id]);
  }, 30_000);

  it('shelf/bin -> shelf/bin transfer succeeds (same mechanism as any location)', async () => {
    const { data: shelf1 } = await supabase
      .from('warehouse_locations')
      .insert({
        tenant_id: TEST_TENANT_ID,
        warehouse_id: warehouseId,
        code: `REGR-SH1-${Date.now()}`,
        name: 'Shelf 1',
        location_type: 'zone',
      })
      .select()
      .single();
    const { data: shelf2 } = await supabase
      .from('warehouse_locations')
      .insert({
        tenant_id: TEST_TENANT_ID,
        warehouse_id: warehouseId,
        code: `REGR-SH2-${Date.now()}`,
        name: 'Shelf 2',
        location_type: 'zone',
      })
      .select()
      .single();

    await seedStock(warehouseId, 8, shelf1.id);

    const { data: transfer } = await supabase
      .from('stock_transfers')
      .insert({
        tenant_id: TEST_TENANT_ID,
        from_warehouse_id: warehouseId,
        to_warehouse_id: warehouseId,
        transfer_number: `REGR-SHELF-${Date.now()}`,
        status: 'draft',
      })
      .select()
      .single();
    await supabase.from('stock_transfer_items').insert({
      tenant_id: TEST_TENANT_ID,
      stock_transfer_id: transfer.id,
      item_id: itemId,
      quantity: 3,
      from_location_id: shelf1.id,
      to_location_id: shelf2.id,
    });

    const { dispatchError, receiveError } = await runTransferCycle(transfer.id);
    expect(dispatchError).toBeNull();
    expect(receiveError).toBeNull();
    expect(await balanceAt(shelf1.id)).toBe(5);
    expect(await balanceAt(shelf2.id)).toBe(3);

    await supabase
      .from('stock_transfer_items')
      .delete()
      .eq('stock_transfer_id', transfer.id);
    await supabase.from('stock_transfers').delete().eq('id', transfer.id);
    await supabase
      .from('warehouse_locations')
      .delete()
      .in('id', [shelf1.id, shelf2.id]);
  }, 30_000);

  it('rejects a transfer to the same location within the same warehouse', async () => {
    const { data: loc } = await supabase
      .from('warehouse_locations')
      .insert({
        tenant_id: TEST_TENANT_ID,
        warehouse_id: warehouseId,
        code: `REGR-SAME-${Date.now()}`,
        name: 'Same Loc',
        location_type: 'zone',
      })
      .select()
      .single();

    const { data: transfer } = await supabase
      .from('stock_transfers')
      .insert({
        tenant_id: TEST_TENANT_ID,
        from_warehouse_id: warehouseId,
        to_warehouse_id: warehouseId,
        transfer_number: `REGR-SAMELOC-${Date.now()}`,
        status: 'draft',
      })
      .select()
      .single();

    const { error } = await supabase.from('stock_transfer_items').insert({
      tenant_id: TEST_TENANT_ID,
      stock_transfer_id: transfer.id,
      item_id: itemId,
      quantity: 1,
      from_location_id: loc.id,
      to_location_id: loc.id,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toContain('two different locations');

    await supabase.from('stock_transfers').delete().eq('id', transfer.id);
    await supabase.from('warehouse_locations').delete().eq('id', loc.id);
  }, 30_000);

  it('rejects a same-warehouse transfer line with no locations at all', async () => {
    const { data: transfer } = await supabase
      .from('stock_transfers')
      .insert({
        tenant_id: TEST_TENANT_ID,
        from_warehouse_id: warehouseId,
        to_warehouse_id: warehouseId,
        transfer_number: `REGR-NOLOC-${Date.now()}`,
        status: 'draft',
      })
      .select()
      .single();

    const { error } = await supabase.from('stock_transfer_items').insert({
      tenant_id: TEST_TENANT_ID,
      stock_transfer_id: transfer.id,
      item_id: itemId,
      quantity: 1,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toContain(
      'requires both from_location_id and to_location_id',
    );

    await supabase.from('stock_transfers').delete().eq('id', transfer.id);
  }, 30_000);

  it('dispatch is blocked before approval (migration 117 gate still enforced)', async () => {
    const { data: whB } = await supabase
      .from('warehouses')
      .insert({
        tenant_id: TEST_TENANT_ID,
        name: `Regr WH Gate ${Date.now()}`,
        code: `RWG${Date.now() % 100000}`,
      })
      .select()
      .single();
    const { data: transfer } = await supabase
      .from('stock_transfers')
      .insert({
        tenant_id: TEST_TENANT_ID,
        from_warehouse_id: warehouseId,
        to_warehouse_id: whB.id,
        transfer_number: `REGR-GATE-${Date.now()}`,
        status: 'draft',
      })
      .select()
      .single();

    const { error } = await supabase.rpc('fn_transfer_dispatch', {
      p_transfer_id: transfer.id,
      p_actor_id: null,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toContain('is not approved');

    await supabase.from('stock_transfers').delete().eq('id', transfer.id);
    await supabase.from('warehouses').delete().eq('id', whB.id);
  }, 30_000);
});
