// Regression suite for the fn_confirm_warehouse_task history old_status
// fix (migration 250). Root cause: the history INSERT hardcoded the
// literal string 'in_progress' as old_status instead of the task's real
// prior status captured before the UPDATE — confirming an 'assigned'
// task's first quantity wrongly recorded old_status='in_progress'
// instead of 'assigned'. Fixed by capturing v_old_status before the
// UPDATE, mirroring fn_cancel_warehouse_task's existing v_old_status
// pattern. This suite calls the real RPC directly against real
// warehouse_tasks rows, same established convention as every other
// regression file in this directory.
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const TENANT = '9bcd3369-d664-47c8-b297-3bc9b429aacf'; // Sefay Demo

describe('fn_confirm_warehouse_task history old_status fix (migration 250)', () => {
  let supabase: SupabaseClient;
  let branchId: string;
  let actorId: string;
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
      .limit(1);
    actorId = users[0].id;
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
        name: 'F250 Confirm History QA WH',
        code: `F250HIST-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
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
        name: 'F250 Confirm History QA Item',
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
        status: 'assigned',
        assigned_to: actorId,
        created_by: actorId,
        ...overrides,
      })
      .select()
      .single();
    if (error) throw error;
    cleanupTaskIds.push(task.id);
    return task;
  };

  const latestHistory = async (taskId: string) => {
    const { data, error } = await supabase
      .from('warehouse_work_status_history')
      .select('*')
      .eq('tenant_id', TENANT)
      .eq('entity_type', 'warehouse_task')
      .eq('entity_id', taskId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data;
  };

  it('1. confirming an assigned task records old_status=assigned, new_status=in_progress', async () => {
    const whId = await mkWarehouse();
    const itemId = await mkItem();
    const locationId = await mkLocation(whId);
    const task = await mkTask(whId, itemId, 10);

    const { data, error } = await supabase.rpc('fn_confirm_warehouse_task', {
      p_task_id: task.id,
      p_tenant_id: TENANT,
      p_quantity: 4,
      p_confirmed_location_id: locationId,
      p_actor_id: actorId,
    });
    expect(error).toBeNull();
    expect(data.status).toBe('in_progress');

    const history = await latestHistory(task.id);
    expect(history).toHaveLength(1);
    expect(history[0].old_status).toBe('assigned');
    expect(history[0].new_status).toBe('in_progress');
  }, 20000);

  it('2. confirming a partially-completed (in_progress) task records old_status=in_progress, new_status=in_progress', async () => {
    const whId = await mkWarehouse();
    const itemId = await mkItem();
    const locationId = await mkLocation(whId);
    const task = await mkTask(whId, itemId, 10, {
      status: 'in_progress',
      quantity_completed: 4,
      started_at: new Date().toISOString(),
    });

    const { data, error } = await supabase.rpc('fn_confirm_warehouse_task', {
      p_task_id: task.id,
      p_tenant_id: TENANT,
      p_quantity: 3,
      p_confirmed_location_id: locationId,
      p_actor_id: actorId,
    });
    expect(error).toBeNull();
    expect(data.quantity_completed).toBe(7);
    expect(data.status).toBe('in_progress');

    const history = await latestHistory(task.id);
    expect(history).toHaveLength(1);
    expect(history[0].old_status).toBe('in_progress');
    expect(history[0].new_status).toBe('in_progress');
  }, 20000);

  it('3. confirming the final remaining quantity records old_status=in_progress, new_status=completed', async () => {
    const whId = await mkWarehouse();
    const itemId = await mkItem();
    const locationId = await mkLocation(whId);
    const task = await mkTask(whId, itemId, 10, {
      status: 'in_progress',
      quantity_completed: 7,
      started_at: new Date().toISOString(),
    });

    const { data, error } = await supabase.rpc('fn_confirm_warehouse_task', {
      p_task_id: task.id,
      p_tenant_id: TENANT,
      p_quantity: 3,
      p_confirmed_location_id: locationId,
      p_actor_id: actorId,
    });
    expect(error).toBeNull();
    expect(data.quantity_completed).toBe(10);
    expect(data.status).toBe('completed');

    const history = await latestHistory(task.id);
    expect(history).toHaveLength(1);
    expect(history[0].old_status).toBe('in_progress');
    expect(history[0].new_status).toBe('completed');
  }, 20000);

  it('4. tenant isolation: confirm rejects a task id under another tenant, and no history row is written', async () => {
    const { data: otherTenant } = await supabase
      .from('tenants')
      .select('id')
      .neq('id', TENANT)
      .limit(1);
    if (!otherTenant?.[0]) return;
    const whId = await mkWarehouse();
    const itemId = await mkItem();
    const locationId = await mkLocation(whId);
    const task = await mkTask(whId, itemId, 10);

    const { error } = await supabase.rpc('fn_confirm_warehouse_task', {
      p_task_id: task.id,
      p_tenant_id: otherTenant[0].id,
      p_quantity: 4,
      p_confirmed_location_id: locationId,
      p_actor_id: actorId,
    });
    expect(error).not.toBeNull();
    expect(error.message).toContain('not found');

    const history = await latestHistory(task.id);
    expect(history).toHaveLength(0);
  }, 20000);

  it('5. history ordering: multiple sequential confirms produce chronologically correct old->new transitions with no gaps', async () => {
    const whId = await mkWarehouse();
    const itemId = await mkItem();
    const locationId = await mkLocation(whId);
    const task = await mkTask(whId, itemId, 12);

    await supabase.rpc('fn_confirm_warehouse_task', {
      p_task_id: task.id,
      p_tenant_id: TENANT,
      p_quantity: 5,
      p_confirmed_location_id: locationId,
      p_actor_id: actorId,
    });
    await supabase.rpc('fn_confirm_warehouse_task', {
      p_task_id: task.id,
      p_tenant_id: TENANT,
      p_quantity: 4,
      p_confirmed_location_id: locationId,
      p_actor_id: actorId,
    });
    await supabase.rpc('fn_confirm_warehouse_task', {
      p_task_id: task.id,
      p_tenant_id: TENANT,
      p_quantity: 3,
      p_confirmed_location_id: locationId,
      p_actor_id: actorId,
    });

    const history = await latestHistory(task.id);
    expect(history).toHaveLength(3);
    expect(history.map((h) => [h.old_status, h.new_status])).toEqual([
      ['assigned', 'in_progress'],
      ['in_progress', 'in_progress'],
      ['in_progress', 'completed'],
    ]);
    // Each row's new_status must equal the next row's old_status — no gaps,
    // no skipped/duplicated transitions.
    for (let i = 0; i < history.length - 1; i++) {
      expect(history[i].new_status).toBe(history[i + 1].old_status);
    }
  }, 20000);

  it('6. no duplicate history rows are written per confirm call', async () => {
    const whId = await mkWarehouse();
    const itemId = await mkItem();
    const locationId = await mkLocation(whId);
    const task = await mkTask(whId, itemId, 5);

    await supabase.rpc('fn_confirm_warehouse_task', {
      p_task_id: task.id,
      p_tenant_id: TENANT,
      p_quantity: 5,
      p_confirmed_location_id: locationId,
      p_actor_id: actorId,
    });

    const history = await latestHistory(task.id);
    expect(history).toHaveLength(1);
  }, 20000);
});
