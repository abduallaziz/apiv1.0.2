import { ensureBranchWarehouse } from './branch-warehouse.util';

// Tiny chainable supabase fake: every call returns the chain; the terminal
// methods (maybeSingle/single/await on update) resolve from `plan`.
function fakeSupabase(plan: {
  existingWarehouseId?: string | null;
  insertResult?: { data: { id: string } | null; error: any };
  linkError?: any;
}) {
  const calls: { table: string; op: string; payload?: any }[] = [];
  const from = (table: string) => {
    let op = 'select';
    let payload: any;
    const chain: any = {
      select: () => chain,
      insert: (p: any) => {
        op = 'insert';
        payload = p;
        calls.push({ table, op, payload });
        return chain;
      },
      update: (p: any) => {
        op = 'update';
        payload = p;
        calls.push({ table, op, payload });
        return chain;
      },
      eq: () => chain,
      maybeSingle: () =>
        Promise.resolve({
          data: { default_warehouse_id: plan.existingWarehouseId ?? null },
        }),
      single: () =>
        Promise.resolve(
          plan.insertResult ?? { data: { id: 'wh-new' }, error: null },
        ),
      then: (resolve: any) => resolve({ error: plan.linkError ?? null }),
    };
    return chain;
  };
  return { client: { from } as any, calls };
}

describe('ensureBranchWarehouse', () => {
  const branchId = '11111111-2222-3333-4444-555555555555';

  it('creates a warehouse for the branch and links it as the default', async () => {
    const { client, calls } = fakeSupabase({});
    const id = await ensureBranchWarehouse(client, 't1', branchId, 'Main');
    expect(id).toBe('wh-new');
    const insert = calls.find(
      (c) => c.table === 'warehouses' && c.op === 'insert',
    )!;
    expect(insert.payload).toMatchObject({
      tenant_id: 't1',
      branch_id: branchId,
      code: 'WH-11111111',
      is_active: true,
    });
    const link = calls.find(
      (c) => c.table === 'branches' && c.op === 'update',
    )!;
    expect(link.payload).toEqual({ default_warehouse_id: 'wh-new' });
  });

  it('does nothing when the branch already has a default warehouse', async () => {
    const { client, calls } = fakeSupabase({
      existingWarehouseId: 'wh-existing',
    });
    const id = await ensureBranchWarehouse(client, 't1', branchId, 'Main');
    expect(id).toBe('wh-existing');
    expect(calls).toHaveLength(0);
  });

  it('never throws (branch/tenant creation must not be blocked) and logs instead', async () => {
    const { client } = fakeSupabase({
      insertResult: { data: null, error: { message: 'duplicate key' } },
    });
    const warn = jest.fn();
    await expect(
      ensureBranchWarehouse(client, 't1', branchId, 'Main', { warn }),
    ).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('duplicate key'));
  });
});
