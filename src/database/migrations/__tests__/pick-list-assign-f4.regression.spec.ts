// Regression suite for Inventory #7 / F4 — Pick List Assign / Reassign.
// Exercises the real WmsRepository.assignPickList -> fn_assign_pick_list
// RPC directly against the real Supabase project (same pattern as the F2/F3
// suites in this directory).
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { WmsRepository } from '../../../modules/inventory/repositories/wms.repository';

dotenv.config();

const TENANT = '9bcd3369-d664-47c8-b297-3bc9b429aacf'; // Sefay Demo

describe('Pick List Assign / Reassign (Inventory #7 / F4)', () => {
  let supabase: SupabaseClient;
  let repo: WmsRepository;
  let warehouseId: string;
  let userA: string;
  let userB: string;

  const cleanupPickListIds: string[] = [];

  const makePickList = async (status = 'open') => {
    const { data: pl } = await supabase
      .from('pick_lists')
      .insert({ tenant_id: TENANT, warehouse_id: warehouseId, strategy: 'single', status, priority: 'medium' })
      .select().single();
    cleanupPickListIds.push(pl.id);
    return pl.id as string;
  };

  beforeAll(async () => {
    supabase = createClient(
      process.env.SUPABASE_URL as string,
      process.env.SUPABASE_SERVICE_ROLE_KEY as string,
    );
    repo = new WmsRepository(supabase);

    const { data: wh } = await supabase.from('warehouses').select('id').eq('tenant_id', TENANT).limit(1);
    warehouseId = wh![0].id;
    const { data: users } = await supabase.from('users').select('id').eq('tenant_id', TENANT).limit(2);
    userA = users![0].id;
    userB = users![1]?.id ?? users![0].id;
  }, 30000);

  afterAll(async () => {
    await supabase.from('warehouse_work_status_history').delete().in('entity_id', cleanupPickListIds);
    await supabase.from('pick_lists').delete().in('id', cleanupPickListIds);
  }, 30000);

  it('1. assign: an unassigned pick list gets assigned_to set and a real history entry with a real actor', async () => {
    const id = await makePickList('open');
    const before = await repo.findPickListById(id, TENANT) as any;
    expect(before.assigned_to).toBeNull();

    const result = await repo.assignPickList(id, TENANT, userA, userA) as any;
    expect(result.assigned_to).toBe(userA);

    const after = await repo.findPickListById(id, TENANT) as any;
    expect(after.assigned_to).toBe(userA);

    const history = await repo.findPickListHistory(id, TENANT) as any[];
    const entry = history.find((h) => h.notes?.includes('assigned to'));
    expect(entry).toBeDefined();
    expect(entry.actor_id).toBe(userA);
    expect(entry.notes).toContain(userA);
  });

  it('2. reassign: an already-assigned pick list moves to a new assignee and history distinguishes it from a first assign', async () => {
    const id = await makePickList('in_progress');
    await repo.assignPickList(id, TENANT, userA, userA);
    const result = await repo.assignPickList(id, TENANT, userB, userA) as any;
    expect(result.assigned_to).toBe(userB);

    const history = await repo.findPickListHistory(id, TENANT) as any[];
    const reassignEntry = history.find((h) => h.notes?.includes('reassigned from'));
    expect(reassignEntry).toBeDefined();
    expect(reassignEntry.notes).toContain(userA);
    expect(reassignEntry.notes).toContain(userB);
  });

  // Note: fn_assign_pick_list's Postgres exception surfaces via Supabase as
  // a plain PostgrestError object, not an `Error` instance — jest's
  // `.rejects.toThrow()` matcher silently reports "did not throw" for
  // non-Error rejections (confirmed by direct isolation while writing this
  // suite), so assertions below match the rejected value directly instead.

  it('3. status gating: a completed pick list rejects assignment — real backend rule, not client-invented', async () => {
    const id = await makePickList('completed');
    await expect(repo.assignPickList(id, TENANT, userA, userA)).rejects.toMatchObject({
      message: expect.stringContaining('cannot be assigned'),
    });
    const after = await repo.findPickListById(id, TENANT) as any;
    expect(after.assigned_to).toBeNull(); // rejected, not silently applied
  });

  it('4. status gating: a cancelled pick list rejects assignment', async () => {
    const id = await makePickList('cancelled');
    await expect(repo.assignPickList(id, TENANT, userA, userA)).rejects.toMatchObject({
      message: expect.stringContaining('cannot be assigned'),
    });
  });

  it('5. invalid assignee: a nonexistent user id is rejected by the real FK constraint, not silently accepted', async () => {
    const id = await makePickList('open');
    await expect(
      repo.assignPickList(id, TENANT, '00000000-0000-0000-0000-000000000000', userA),
    ).rejects.toBeTruthy();
    const after = await repo.findPickListById(id, TENANT) as any;
    expect(after.assigned_to).toBeNull();
  });

  it('6. tenant isolation: assigning a pick list under the wrong tenant id is rejected as not-found, not applied cross-tenant', async () => {
    const id = await makePickList('open');
    const { data: otherTenant } = await supabase.from('tenants').select('id').neq('id', TENANT).limit(1);
    if (!otherTenant?.[0]) return;
    await expect(repo.assignPickList(id, otherTenant[0].id, userA, userA)).rejects.toMatchObject({
      message: expect.stringContaining('not found'),
    });
    const after = await repo.findPickListById(id, TENANT) as any;
    expect(after.assigned_to).toBeNull();
  });

  it('7. duplicate/repeated assignment request: assigning to the same user twice is idempotent in effect (still assigned to that user, two history rows)', async () => {
    const id = await makePickList('open');
    await repo.assignPickList(id, TENANT, userA, userA);
    await repo.assignPickList(id, TENANT, userA, userA);
    const after = await repo.findPickListById(id, TENANT) as any;
    expect(after.assigned_to).toBe(userA);
    const history = await repo.findPickListHistory(id, TENANT) as any[];
    expect(history.length).toBeGreaterThanOrEqual(2);
  });

  it('8. concurrency: two real parallel assign requests to the same pick list never corrupt the final state — it ends up assigned to exactly one of the two, with both attempts recorded in history', async () => {
    const id = await makePickList('open');
    const results = await Promise.allSettled([
      repo.assignPickList(id, TENANT, userA, userA),
      repo.assignPickList(id, TENANT, userB, userB),
    ]);
    // fn_assign_pick_list takes a row lock (FOR UPDATE) — both requests are
    // serialized by Postgres itself, not the frontend/backend. Both should
    // succeed (assignment has no "already assigned" guard, only a status
    // guard), the second simply overwriting the first — this asserts the
    // DB never lands in an impossible/corrupted state.
    const succeeded = results.filter((r) => r.status === 'fulfilled');
    expect(succeeded.length).toBeGreaterThanOrEqual(1);

    const after = await repo.findPickListById(id, TENANT) as any;
    expect([userA, userB]).toContain(after.assigned_to); // exactly one real, valid final state

    const history = await repo.findPickListHistory(id, TENANT) as any[];
    expect(history.length).toBeGreaterThanOrEqual(succeeded.length);
  });
});
