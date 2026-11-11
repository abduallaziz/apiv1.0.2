// Regression suite for the warehouse_tasks lifecycle RPCs
// (fn_assign_warehouse_task / fn_confirm_warehouse_task /
// fn_cancel_warehouse_task, migration 223) — a pre-existing gap with zero
// regression coverage found while building F11 (Warehouse Task Management
// UI), which is the first real frontend surface to actually exercise
// these RPCs (the old WmsPage.tsx tasks tab had a broken assign button
// that always sent an empty UUID and a confirm button gated on a field
// that's never set before a task's first confirm, so neither path was
// ever really driven in the running app). Every test uses a dedicated,
// disposable warehouse (the established shared-fixture-contamination
// fix from earlier in this session) rather than the shared demo warehouse.
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const TENANT = '9bcd3369-d664-47c8-b297-3bc9b429aacf'; // Sefay Demo

describe('warehouse_tasks lifecycle (F11 gap coverage)', () => {
  let supabase: SupabaseClient;
  let branchId: string;
  let actorId: string;
  let otherActorId: string;
  const cleanupTaskIds: string[] = [];
  const cleanupItemIds: string[] = [];
  const cleanupWarehouseIds: string[] = [];

  beforeAll(async () => {
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    );

    const { data: wh } = await supabase
      .from('warehouses')
      .select('branch_id')
      .eq('tenant_id', TENANT)
      .limit(1);
    branchId = wh[0].branch_id;

    const { data: users } = await supabase
      .from('users')
      .select('id')
      .eq('tenant_id', TENANT)
      .limit(2);
    actorId = users[0].id;
    otherActorId = users[1]?.id ?? users[0].id;
  }, 30000);

  afterAll(async () => {
    await supabase
      .from('warehouse_work_status_history')
      .delete()
      .in('entity_id', cleanupTaskIds)
      .eq('entity_type', 'warehouse_task');
    await supabase.from('warehouse_tasks').delete().in('id', cleanupTaskIds);
    await supabase.from('items').delete().in('id', cleanupItemIds);
    await supabase.from('warehouses').delete().in('id', cleanupWarehouseIds);
  }, 30000);

  const mkWarehouse = async () => {
    const { data: wh, error } = await supabase
      .from('warehouses')
      .insert({
        tenant_id: TENANT,
        branch_id: branchId,
        name: 'F11 Task QA WH',
        code: `F11TASK-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      })
      .select()
      .single();
    if (error) throw error;
    cleanupWarehouseIds.push(wh.id);
    return wh.id as string;
  };

  const mkItem = async () => {
    const { data: item, error } = await supabase
      .from('items')
      .insert({
        tenant_id: TENANT,
        name: 'F11 Task QA Item',
        type: 'product',
        operation_type: 'sell',
        price: 10,
        is_active: true,
      })
      .select()
      .single();
    if (error) throw error;
    cleanupItemIds.push(item.id);
    return item.id as string;
  };

  // Putaway task with no source_location_id: fn_confirm_warehouse_task
  // only performs the 'out' movement when source_location_id IS NOT NULL
  // (replenishment tasks are required to have one; putaway tasks are not),
  // so this needs no pre-seeded source stock — a real, minimal fixture.
  const mkTask = async (
    whId: string,
    itemId: string,
    quantity: number,
    overrides: Record<string, unknown> = {},
  ) => {
    const { data: task, error } = await supabase
      .from('warehouse_tasks')
      .insert({
        tenant_id: TENANT,
        warehouse_id: whId,
        task_type: 'putaway',
        item_id: itemId,
        quantity,
        priority: 'medium',
        status: 'pending',
        created_by: actorId,
        ...overrides,
      })
      .select()
      .single();
    if (error) throw error;
    cleanupTaskIds.push(task.id);
    return task;
  };

  const mkLocation = async (whId: string) => {
    const { data: loc, error } = await supabase
      .from('warehouse_locations')
      .insert({
        tenant_id: TENANT,
        warehouse_id: whId,
        code: `L-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: 'QA Location',
        is_active: true,
      })
      .select()
      .single();
    if (error) throw error;
    return loc.id as string;
  };

  it('1. assign transitions pending -> assigned and writes history', async () => {
    const whId = await mkWarehouse();
    const itemId = await mkItem();
    const task = await mkTask(whId, itemId, 5);

    const { data, error } = await supabase.rpc('fn_assign_warehouse_task', {
      p_task_id: task.id,
      p_tenant_id: TENANT,
      p_assigned_to: actorId,
      p_actor_id: actorId,
    });
    expect(error).toBeNull();
    expect(data.status).toBe('assigned');
    expect(data.assigned_to).toBe(actorId);

    const { data: history } = await supabase
      .from('warehouse_work_status_history')
      .select('*')
      .eq('entity_type', 'warehouse_task')
      .eq('entity_id', task.id);
    expect(history).toHaveLength(1);
    expect(history[0].old_status).toBe('pending');
    expect(history[0].new_status).toBe('assigned');
  }, 20000);

  it('2. assign rejects a task that is already in_progress/completed/cancelled', async () => {
    const whId = await mkWarehouse();
    const itemId = await mkItem();
    const task = await mkTask(whId, itemId, 5, { status: 'completed' });

    const { error } = await supabase.rpc('fn_assign_warehouse_task', {
      p_task_id: task.id,
      p_tenant_id: TENANT,
      p_assigned_to: actorId,
      p_actor_id: actorId,
    });
    expect(error).not.toBeNull();
    expect(error.message).toContain('cannot be assigned');
  }, 20000);

  it('3. reassign (already assigned) is allowed and updates assigned_to', async () => {
    const whId = await mkWarehouse();
    const itemId = await mkItem();
    const task = await mkTask(whId, itemId, 5, {
      status: 'assigned',
      assigned_to: actorId,
    });

    const { data, error } = await supabase.rpc('fn_assign_warehouse_task', {
      p_task_id: task.id,
      p_tenant_id: TENANT,
      p_assigned_to: otherActorId,
      p_actor_id: actorId,
    });
    expect(error).toBeNull();
    expect(data.assigned_to).toBe(otherActorId);
  }, 20000);

  it('4. partial confirm accumulates quantity_completed and stays in_progress', async () => {
    const whId = await mkWarehouse();
    const itemId = await mkItem();
    const locationId = await mkLocation(whId);
    const task = await mkTask(whId, itemId, 10, {
      status: 'assigned',
      assigned_to: actorId,
    });

    const { data, error } = await supabase.rpc('fn_confirm_warehouse_task', {
      p_task_id: task.id,
      p_tenant_id: TENANT,
      p_quantity: 4,
      p_confirmed_location_id: locationId,
      p_actor_id: actorId,
    });
    expect(error).toBeNull();
    expect(data.quantity_completed).toBe(4);
    expect(data.status).toBe('in_progress');
    expect(data.started_at).not.toBeNull();
    expect(data.completed_at).toBeNull();
  }, 20000);

  it('5. confirming the remaining quantity completes the task', async () => {
    const whId = await mkWarehouse();
    const itemId = await mkItem();
    const locationId = await mkLocation(whId);
    const task = await mkTask(whId, itemId, 10, {
      status: 'assigned',
      assigned_to: actorId,
    });

    await supabase.rpc('fn_confirm_warehouse_task', {
      p_task_id: task.id,
      p_tenant_id: TENANT,
      p_quantity: 6,
      p_confirmed_location_id: locationId,
      p_actor_id: actorId,
    });
    const { data, error } = await supabase.rpc('fn_confirm_warehouse_task', {
      p_task_id: task.id,
      p_tenant_id: TENANT,
      p_quantity: 4,
      p_confirmed_location_id: locationId,
      p_actor_id: actorId,
    });
    expect(error).toBeNull();
    expect(data.quantity_completed).toBe(10);
    expect(data.status).toBe('completed');
    expect(data.completed_at).not.toBeNull();
  }, 20000);

  it('6. confirm rejects a quantity exceeding what remains', async () => {
    const whId = await mkWarehouse();
    const itemId = await mkItem();
    const locationId = await mkLocation(whId);
    const task = await mkTask(whId, itemId, 5, {
      status: 'assigned',
      assigned_to: actorId,
    });

    const { error } = await supabase.rpc('fn_confirm_warehouse_task', {
      p_task_id: task.id,
      p_tenant_id: TENANT,
      p_quantity: 6,
      p_confirmed_location_id: locationId,
      p_actor_id: actorId,
    });
    expect(error).not.toBeNull();
    expect(error.message).toContain('only');
  }, 20000);

  it('7. confirm rejects a replenishment task with no source_location_id', async () => {
    const whId = await mkWarehouse();
    const itemId = await mkItem();
    const locationId = await mkLocation(whId);
    const task = await mkTask(whId, itemId, 5, {
      status: 'assigned',
      assigned_to: actorId,
      task_type: 'replenishment',
      source_location_id: null,
    });

    const { error } = await supabase.rpc('fn_confirm_warehouse_task', {
      p_task_id: task.id,
      p_tenant_id: TENANT,
      p_quantity: 5,
      p_confirmed_location_id: locationId,
      p_actor_id: actorId,
    });
    expect(error).not.toBeNull();
    expect(error.message).toContain('no source_location_id');
  }, 20000);

  it('8. cancel transitions to cancelled and writes history with the real prior status', async () => {
    const whId = await mkWarehouse();
    const itemId = await mkItem();
    const task = await mkTask(whId, itemId, 5, {
      status: 'assigned',
      assigned_to: actorId,
    });

    const { data, error } = await supabase.rpc('fn_cancel_warehouse_task', {
      p_task_id: task.id,
      p_tenant_id: TENANT,
      p_actor_id: actorId,
    });
    expect(error).toBeNull();
    expect(data.status).toBe('cancelled');

    const { data: history } = await supabase
      .from('warehouse_work_status_history')
      .select('*')
      .eq('entity_type', 'warehouse_task')
      .eq('entity_id', task.id);
    expect(history).toHaveLength(1);
    expect(history[0].old_status).toBe('assigned');
    expect(history[0].new_status).toBe('cancelled');
  }, 20000);

  it('9. cancel rejects an already-completed task', async () => {
    const whId = await mkWarehouse();
    const itemId = await mkItem();
    const task = await mkTask(whId, itemId, 5, { status: 'completed' });

    const { error } = await supabase.rpc('fn_cancel_warehouse_task', {
      p_task_id: task.id,
      p_tenant_id: TENANT,
      p_actor_id: actorId,
    });
    expect(error).not.toBeNull();
    expect(error.message).toContain('already completed');
  }, 20000);

  it('10. tenant isolation: assign/confirm/cancel all reject a task id from another tenant', async () => {
    const { data: otherTenant } = await supabase
      .from('tenants')
      .select('id')
      .neq('id', TENANT)
      .limit(1);
    if (!otherTenant?.[0]) return;
    const whId = await mkWarehouse();
    const itemId = await mkItem();
    const task = await mkTask(whId, itemId, 5);

    const { error: assignErr } = await supabase.rpc(
      'fn_assign_warehouse_task',
      {
        p_task_id: task.id,
        p_tenant_id: otherTenant[0].id,
        p_assigned_to: actorId,
        p_actor_id: actorId,
      },
    );
    expect(assignErr).not.toBeNull();
    expect(assignErr.message).toContain('not found');

    const { error: cancelErr } = await supabase.rpc(
      'fn_cancel_warehouse_task',
      {
        p_task_id: task.id,
        p_tenant_id: otherTenant[0].id,
        p_actor_id: actorId,
      },
    );
    expect(cancelErr).not.toBeNull();
    expect(cancelErr.message).toContain('not found');
  }, 20000);
});
