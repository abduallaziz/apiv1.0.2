import { guardClient } from './guarded-client';

const OK = '11111111-1111-4111-8111-111111111111';
const BAD = '22222222-2222-4222-8222-222222222222';

// Minimal fake of a postgrest-style thenable, chainable builder (no network).
function fakeClient() {
  const calls: string[] = [];
  const builder = (): any => {
    const b: any = {};
    for (const m of ['select', 'insert', 'upsert', 'update', 'delete', 'eq', 'in', 'neq', 'is', 'limit', 'single']) {
      b[m] = (...a: unknown[]) => {
        calls.push(m);
        return b;
      };
    }
    b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(res);
    return b;
  };
  return {
    calls,
    client: {
      from: (_table?: string) => builder(),
      rpc: (fn: string, _args?: unknown) => {
        calls.push(`rpc:${fn}`);
        return Promise.resolve({ data: null, error: null });
      },
    },
  };
}

describe('guardClient', () => {
  it('blocks insert/upsert for a non-test tenant, allows the test tenant', () => {
    const { client } = fakeClient();
    const g = guardClient(client, [OK]);
    expect(() => g.from('items').insert({ tenant_id: BAD })).toThrow(/not an allowed test tenant/);
    expect(() => g.from('items').upsert([{ tenant_id: OK }, { tenant_id: BAD }])).toThrow();
    expect(() => g.from('items').insert({ tenant_id: OK, name: 'x' })).not.toThrow();
    expect(() => g.from('child').insert({ item_id: 'i' })).not.toThrow(); // no tenant_id column
  });

  it('blocks rpc with a foreign tenant, allows the test tenant and tenant-less', () => {
    const { client, calls } = fakeClient();
    const g = guardClient(client, [OK]);
    expect(() => g.rpc('fn_x', { p_tenant_id: BAD })).toThrow(/not an allowed test tenant/);
    g.rpc('fn_x', { p_tenant_id: OK });
    g.rpc('fn_y', { p_item_id: 'i' });
    expect(calls).toEqual(['rpc:fn_x', 'rpc:fn_y']);
  });

  it('rejects update/delete with no filter at all', async () => {
    const { client } = fakeClient();
    const g = guardClient(client, [OK]);
    await expect(g.from('items').delete()).rejects.toThrow(/without any filter/);
    await expect(g.from('items').update({ name: 'x' })).rejects.toThrow(/without any filter/);
  });

  it('allows filtered update/delete and plain reads', async () => {
    const { client } = fakeClient();
    const g = guardClient(client, [OK]);
    await expect(g.from('items').delete().eq('id', 'i')).resolves.toBeDefined();
    await expect(g.from('items').update({ name: 'x' }).in('id', ['a'])).resolves.toBeDefined();
    await expect(g.from('items').select('*').limit(1).single()).resolves.toBeDefined();
  });
});
