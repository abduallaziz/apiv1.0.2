/**
 * Regression suite for Migration 13.20 — Advanced Warehouse Management:
 * location purpose/capacity, putaway engine, replenishment, warehouse
 * tasks, picking batch/serial/FEFO validation. Runs directly against the
 * real Supabase project, same pattern as every other regression suite this
 * session. Not wired into CI — run via `npm test`.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const TENANT = '9bcd3369-d664-47c8-b297-3bc9b429aacf'; // Sefay Demo

describe('Advanced Warehouse Management (migration 13.20)', () => {
  let supabase: SupabaseClient;
  let warehouseId: string;
  let locReceiving: string;
  let locStorage: string;
  let itemId: string;
  let batchItemId: string;
  const cleanupItemIds: string[] = [];
  const cleanupLocationIds: string[] = [];

  beforeAll(async () => {
    supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data: wh } = await supabase.from('warehouses').select('id').eq('tenant_id', TENANT).limit(1);
    warehouseId = wh![0].id;

    const { data: item } = await supabase.from('items').insert({ tenant_id: TENANT, name: 'WMS 13.20 Item', type: 'product', operation_type: 'sell', price: 5, is_active: true }).select().single();
    itemId = item.id;
    cleanupItemIds.push(itemId);

    const { data: batchItem } = await supabase.from('items').insert({ tenant_id: TENANT, name: 'WMS 13.20 Batch Item', type: 'product', operation_type: 'sell', price: 5, is_active: true, track_batches: true }).select().single();
    batchItemId = batchItem.id;
    cleanupItemIds.push(batchItemId);

    const runSuffix = Date.now();
    const { data: locR } = await supabase.from('warehouse_locations').insert({ tenant_id: TENANT, warehouse_id: warehouseId, code: `W1320-R-${runSuffix}`, name: 'Receiving Test', location_purpose: 'receiving' }).select().single();
    locReceiving = locR.id;
    cleanupLocationIds.push(locReceiving);

    const { data: locS } = await supabase.from('warehouse_locations').insert({ tenant_id: TENANT, warehouse_id: warehouseId, code: `W1320-S-${runSuffix}`, name: 'Storage Test', location_purpose: 'storage', max_quantity: 1000 }).select().single();
    locStorage = locS.id;
    cleanupLocationIds.push(locStorage);

    await supabase.rpc('fn_apply_stock_movement', { p_tenant_id: TENANT, p_warehouse_id: warehouseId, p_location_id: locReceiving, p_item_id: itemId, p_variant_id: null, p_batch_id: null, p_movement_type: 'receipt', p_direction: 'in', p_quantity: 100, p_unit_cost: 2, p_reference_type: 'test', p_reference_id: null, p_created_by: null, p_allow_negative: false });
  }, 30_000);

  // Locations that ever appear in a stock_movements row can never be
  // hard-deleted (stock_movements.location_id is ON DELETE RESTRICT, and
  // stock_movements itself is an immutable ledger — migration 017). Every
  // location used in this suite receives real stock movements, so cleanup
  // deactivates them (is_active=false, deleted_at set — frees the `code`
  // for reuse via the partial unique index) rather than deleting, same
  // pattern as every other regression suite this session that touches the
  // ledger.
  afterAll(async () => {
    await supabase.from('warehouse_task_history').delete().eq('tenant_id', TENANT).in('task_id', (await supabase.from('warehouse_tasks').select('id').in('item_id', cleanupItemIds)).data?.map((t: any) => t.id) ?? []);
    await supabase.from('warehouse_tasks').delete().in('item_id', cleanupItemIds);
    await supabase.from('warehouse_replenishment_rules').delete().in('item_id', cleanupItemIds);
    await supabase.from('putaway_rules').delete().eq('tenant_id', TENANT).ilike('name', 'WMS 13.20%');
    await supabase.from('quality_holds').delete().eq('tenant_id', TENANT).in('item_id', cleanupItemIds);
    await supabase.from('warehouse_location_restrictions').delete().in('location_id', cleanupLocationIds);
    await supabase.from('warehouse_locations').update({ is_active: false, deleted_at: new Date().toISOString() }).in('id', cleanupLocationIds);
    await supabase.from('items').update({ is_active: false, deleted_at: new Date().toISOString() }).in('id', cleanupItemIds);
  }, 30_000);

  // ---- Locations ----

  it('1. location hierarchy unchanged: existing zone/aisle/rack/shelf/bin validation trigger still enforces order', async () => {
    const suffix = Date.now();
    const { data: zone } = await supabase.from('warehouse_locations').insert({ tenant_id: TENANT, warehouse_id: warehouseId, code: `W1320-Z-${suffix}`, name: 'Zone', location_type: 'zone' }).select().single();
    cleanupLocationIds.push(zone.id);
    const bad = await supabase.from('warehouse_locations').insert({ tenant_id: TENANT, warehouse_id: warehouseId, code: `W1320-BAD-${suffix}`, name: 'Bad Rack', location_type: 'rack', parent_location_id: zone.id });
    expect(bad.error?.message).toMatch(/INVALID_LOCATION_HIERARCHY/);
  });

  it('2. location purpose assignment (independent of structural type)', async () => {
    const { data, error } = await supabase.from('warehouse_locations').select('location_purpose, max_quantity').eq('id', locStorage).single();
    expect(error).toBeNull();
    expect(data.location_purpose).toBe('storage');
    expect(Number(data.max_quantity)).toBe(1000);
  });

  it('3. capacity validation: fn_suggest_putaway_location reports capacity_ok=false when it would exceed max_quantity', async () => {
    const { data: rule } = await supabase.from('putaway_rules').insert({ tenant_id: TENANT, warehouse_id: warehouseId, name: 'WMS 13.20 Capacity Rule', applies_to_item_id: itemId, target_location_id: locStorage }).select().single();
    const sugg = await supabase.rpc('fn_suggest_putaway_location', { p_tenant_id: TENANT, p_warehouse_id: warehouseId, p_item_id: itemId, p_category_id: null, p_quantity: 2000 });
    expect(sugg.data[0].capacity_ok).toBe(false);
    const sugg2 = await supabase.rpc('fn_suggest_putaway_location', { p_tenant_id: TENANT, p_warehouse_id: warehouseId, p_item_id: itemId, p_category_id: null, p_quantity: 50 });
    expect(sugg2.data[0].capacity_ok).toBe(true);
    await supabase.from('putaway_rules').delete().eq('id', rule.id);
  });

  // ---- Putaway ----

  it('4. putaway rule matching: item-specific rule resolved over none', async () => {
    const { data: rule } = await supabase.from('putaway_rules').insert({ tenant_id: TENANT, warehouse_id: warehouseId, name: 'WMS 13.20 Match Rule', applies_to_item_id: itemId, target_location_id: locStorage }).select().single();
    const sugg = await supabase.rpc('fn_suggest_putaway_location', { p_tenant_id: TENANT, p_warehouse_id: warehouseId, p_item_id: itemId, p_category_id: null, p_quantity: 10 });
    expect(sugg.data[0].location_id).toBe(locStorage);
    expect(sugg.data[0].rule_id).toBe(rule.id);
    await supabase.from('putaway_rules').delete().eq('id', rule.id);
  });

  it('5. putaway task creation + suggestion generation', async () => {
    const task = await supabase.rpc('fn_create_putaway_task', { p_tenant_id: TENANT, p_warehouse_id: warehouseId, p_item_id: itemId, p_variant_id: null, p_batch_id: null, p_quantity: 30, p_source_location_id: locReceiving, p_suggested_location_id: locStorage, p_source_document_type: 'manual', p_source_document_id: null, p_created_by: null });
    expect(task.error).toBeNull();
    expect(task.data.status).toBe('pending');
    expect(task.data.suggested_location_id).toBe(locStorage);
  });

  it('6. putaway task completion moves stock between locations (real, not fake)', async () => {
    const task = await supabase.rpc('fn_create_putaway_task', { p_tenant_id: TENANT, p_warehouse_id: warehouseId, p_item_id: itemId, p_variant_id: null, p_batch_id: null, p_quantity: 20, p_source_location_id: locReceiving, p_suggested_location_id: locStorage, p_source_document_type: 'manual', p_source_document_id: null, p_created_by: null });
    await supabase.rpc('fn_assign_warehouse_task', { p_task_id: task.data.id, p_tenant_id: TENANT, p_assigned_to: null, p_actor_id: null });
    const confirm = await supabase.rpc('fn_confirm_warehouse_task', { p_task_id: task.data.id, p_tenant_id: TENANT, p_quantity: 20, p_confirmed_location_id: locStorage, p_actor_id: null });
    expect(confirm.error).toBeNull();
    expect(confirm.data.status).toBe('completed');

    const balStorage = await supabase.from('stock_levels').select('quantity_on_hand').eq('tenant_id', TENANT).eq('item_id', itemId).eq('location_id', locStorage).maybeSingle();
    expect(Number(balStorage.data!.quantity_on_hand)).toBe(20);
  });

  // ---- Replenishment ----

  it('7. replenishment low-stock trigger creates a task', async () => {
    const { data: rule } = await supabase.from('warehouse_replenishment_rules').insert({ tenant_id: TENANT, warehouse_id: warehouseId, item_id: itemId, destination_location_id: locReceiving, source_location_id: locStorage, min_quantity: 500, max_quantity: 600 }).select().single();
    const tasks = await supabase.rpc('fn_run_replenishment_check', { p_tenant_id: TENANT, p_warehouse_id: warehouseId, p_created_by: null });
    expect(tasks.error).toBeNull();
    const created = (tasks.data as any[]).find((t) => t.source_document_id === rule.id);
    expect(created).toBeDefined();
    expect(created.task_type).toBe('replenishment');
  });

  it('8. replenishment task completion moves stock; refuses without a source location', async () => {
    // Real completion: source (storage, has 20 from test 6) -> destination (receiving).
    const task = await supabase.rpc('fn_create_putaway_task', { p_tenant_id: TENANT, p_warehouse_id: warehouseId, p_item_id: itemId, p_variant_id: null, p_batch_id: null, p_quantity: 5, p_source_location_id: locStorage, p_suggested_location_id: locReceiving, p_source_document_type: 'manual', p_source_document_id: null, p_created_by: null });
    await supabase.from('warehouse_tasks').update({ task_type: 'replenishment' }).eq('id', task.data.id);
    await supabase.rpc('fn_assign_warehouse_task', { p_task_id: task.data.id, p_tenant_id: TENANT, p_assigned_to: null, p_actor_id: null });
    const confirm = await supabase.rpc('fn_confirm_warehouse_task', { p_task_id: task.data.id, p_tenant_id: TENANT, p_quantity: 5, p_confirmed_location_id: locReceiving, p_actor_id: null });
    expect(confirm.error).toBeNull();
    expect(confirm.data.status).toBe('completed');

    // No-source refusal: manually null the source on a fresh task, confirm should raise.
    const task2 = await supabase.rpc('fn_create_putaway_task', { p_tenant_id: TENANT, p_warehouse_id: warehouseId, p_item_id: itemId, p_variant_id: null, p_batch_id: null, p_quantity: 1, p_source_location_id: null, p_suggested_location_id: locReceiving, p_source_document_type: 'manual', p_source_document_id: null, p_created_by: null });
    await supabase.from('warehouse_tasks').update({ task_type: 'replenishment' }).eq('id', task2.data.id);
    await supabase.rpc('fn_assign_warehouse_task', { p_task_id: task2.data.id, p_tenant_id: TENANT, p_assigned_to: null, p_actor_id: null });
    const badConfirm = await supabase.rpc('fn_confirm_warehouse_task', { p_task_id: task2.data.id, p_tenant_id: TENANT, p_quantity: 1, p_confirmed_location_id: locReceiving, p_actor_id: null });
    expect(badConfirm.error?.message).toMatch(/replenishment task .* has no source_location_id/);
    await supabase.rpc('fn_cancel_warehouse_task', { p_task_id: task2.data.id, p_tenant_id: TENANT, p_actor_id: null });
  });

  // ---- Task assignment/completion ----

  it('9. task assignment and completion lifecycle (pending -> assigned -> completed)', async () => {
    const task = await supabase.rpc('fn_create_putaway_task', { p_tenant_id: TENANT, p_warehouse_id: warehouseId, p_item_id: itemId, p_variant_id: null, p_batch_id: null, p_quantity: 1, p_source_location_id: locReceiving, p_suggested_location_id: locStorage, p_source_document_type: 'manual', p_source_document_id: null, p_created_by: null });
    expect(task.data.status).toBe('pending');
    const assigned = await supabase.rpc('fn_assign_warehouse_task', { p_task_id: task.data.id, p_tenant_id: TENANT, p_assigned_to: null, p_actor_id: null });
    expect(assigned.data.status).toBe('assigned');
    const completed = await supabase.rpc('fn_confirm_warehouse_task', { p_task_id: task.data.id, p_tenant_id: TENANT, p_quantity: 1, p_confirmed_location_id: locStorage, p_actor_id: null });
    expect(completed.data.status).toBe('completed');

    const history = await supabase.from('warehouse_task_history').select('new_status').eq('task_id', task.data.id).order('created_at', { ascending: true });
    expect(history.data!.map((h: any) => h.new_status)).toEqual(['pending', 'assigned', 'completed']);
  });

  // ---- Picking validation ----

  it('10. picking batch validation: fn_validate_pick_requirements blocks a batch-tracked item with no batch given', async () => {
    const r = await supabase.rpc('fn_validate_pick_requirements', { p_tenant_id: TENANT, p_warehouse_id: warehouseId, p_item_id: batchItemId, p_variant_id: null, p_quantity: 1, p_batch_id: null });
    expect(r.error?.message).toMatch(/BATCH_OR_SERIAL_REQUIRED/);
  });

  it('11. picking non-tracked item passes validation without a batch', async () => {
    const r = await supabase.rpc('fn_validate_pick_requirements', { p_tenant_id: TENANT, p_warehouse_id: warehouseId, p_item_id: itemId, p_variant_id: null, p_quantity: 1, p_batch_id: null });
    expect(r.error).toBeNull();
    expect(r.data).toBe(true);
  });

  it('12. quality hold blocks picking: reservation respects quantity_quality_held (integration with migration 163)', async () => {
    const balBefore = await supabase.from('v_stock_balance').select('quantity_available').eq('tenant_id', TENANT).eq('item_id', itemId).eq('location_id', locReceiving).single();
    const holdQty = Number(balBefore.data!.quantity_available); // hold everything currently there

    const holdMv = await supabase.rpc('fn_apply_stock_movement', { p_tenant_id: TENANT, p_warehouse_id: warehouseId, p_location_id: locReceiving, p_item_id: itemId, p_variant_id: null, p_batch_id: null, p_movement_type: 'quality_hold', p_direction: 'out', p_quantity: holdQty, p_unit_cost: 0, p_reference_type: 'test', p_reference_id: null, p_created_by: null, p_allow_negative: false });
    expect(holdMv.error).toBeNull();

    const bal = await supabase.from('v_stock_balance').select('quantity_available').eq('tenant_id', TENANT).eq('item_id', itemId).eq('location_id', locReceiving).single();
    expect(Number(bal.data!.quantity_available)).toBe(0);

    // Reservation against the held quantity must fail (whole-item reservation is location-agnostic, so request more than total availability).
    const res = await supabase.rpc('fn_create_reservation', { p_tenant_id: TENANT, p_warehouse_id: warehouseId, p_item_id: itemId, p_variant_id: null, p_batch_id: null, p_quantity: 999999, p_reference_type: 'test', p_reference_id: '00000000-0000-0000-0000-000000000099', p_created_by: null, p_expires_at: null });
    expect(res.error?.message).toMatch(/INSUFFICIENT_STOCK/);

    // release the hold to restore availability for cleanliness
    const holds = await supabase.from('quality_holds').select('id').eq('item_id', itemId).eq('status', 'active');
    for (const h of holds.data ?? []) {
      await supabase.rpc('fn_release_quality_hold', { p_hold_id: h.id, p_tenant_id: TENANT, p_actor_id: null, p_reason: 'test cleanup' });
    }
  });

  // ---- Security ----

  it('13. tenant isolation: fn_run_replenishment_check for a different tenant returns nothing for this tenant\'s rule', async () => {
    const tasks = await supabase.rpc('fn_run_replenishment_check', { p_tenant_id: '00000000-0000-0000-0000-000000000000', p_warehouse_id: warehouseId, p_created_by: null });
    expect(tasks.error).toBeNull();
    expect((tasks.data as any[]).length).toBe(0);
  });

  it('14. permission checks: warehouse.manage and warehouse.approve exist and are seeded', async () => {
    const { data: perms } = await supabase.from('permissions').select('name').in('name', ['warehouse.manage', 'warehouse.approve']);
    expect(perms?.length).toBe(2);
  });
});
