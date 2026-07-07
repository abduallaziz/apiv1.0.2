import { PermissionsService } from './permissions.service';
import { RedisCacheService } from '../cache/redis-cache.service';

// Minimal fake Supabase client — enough surface to drive the three queries
// PermissionsService makes: role_permissions, tenant_role_permissions, roles.
function buildFakeSupabase(fixtures: {
  globalGrants: Record<string, string[]>; // role -> granted permission_keys
  systemRoleIds: Record<string, string>; // role name -> roles.id
  overrides: Record<string, { permission_key: string; is_granted: boolean }[]>; // `${tenantId}:${roleId}` -> rows
}) {
  return {
    from(table: string) {
      const builder: any = {
        _table: table,
        _eqs: {} as Record<string, unknown>,
        select() {
          return builder;
        },
        eq(col: string, val: unknown) {
          builder._eqs[col] = val;
          return builder;
        },
        is(col: string, val: unknown) {
          builder._eqs[col] = val;
          return builder;
        },
        async maybeSingle() {
          if (table === 'roles') {
            const name = builder._eqs['name'] as string;
            const id = fixtures.systemRoleIds[name];
            return id ? { data: { id }, error: null } : { data: null, error: null };
          }
          throw new Error(`maybeSingle not fixtured for table ${table}`);
        },
        then(resolve: (v: unknown) => unknown) {
          // supports `await builder` directly (no maybeSingle call)
          if (table === 'role_permissions') {
            const role = builder._eqs['role'] as string;
            const rows = (fixtures.globalGrants[role] ?? []).map((k) => ({
              permission_key: k,
            }));
            return resolve({ data: rows, error: null });
          }
          if (table === 'tenant_role_permissions') {
            const tenantId = builder._eqs['tenant_id'] as string;
            const roleId = builder._eqs['role_id'] as string;
            const rows = fixtures.overrides[`${tenantId}:${roleId}`] ?? [];
            return resolve({ data: rows, error: null });
          }
          return resolve({ data: [], error: null });
        },
      };
      return builder;
    },
  };
}

function buildNoopCache(): RedisCacheService {
  // Cache always misses — isolates the resolution algorithm from caching
  // behavior for these tests; cache-specific behavior is covered separately.
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    del: jest.fn().mockResolvedValue(undefined),
    delByPrefix: jest.fn().mockResolvedValue(undefined),
  } as unknown as RedisCacheService;
}

describe('PermissionsService — S5 Stage B (per-permission merge)', () => {
  const TENANT_A = 'tenant-a';
  const TENANT_B = 'tenant-b';
  const MANAGER_ROLE_ID = 'role-manager-id';

  function service(overrides: Record<string, { permission_key: string; is_granted: boolean }[]> = {}) {
    const supabase = buildFakeSupabase({
      globalGrants: {
        manager: ['expenses.view', 'expenses.approve'],
      },
      systemRoleIds: { manager: MANAGER_ROLE_ID },
      overrides,
    });
    const cache = buildNoopCache();
    return new PermissionsService(supabase as any, cache);
  }

  it('worked example: tenant override removes exactly one permission, others untouched', async () => {
    const svc = service({
      [`${TENANT_A}:${MANAGER_ROLE_ID}`]: [
        { permission_key: 'expenses.approve', is_granted: false },
      ],
    });

    await expect(svc.hasPermission('manager', 'expenses.view', TENANT_A)).resolves.toBe(true);
    await expect(svc.hasPermission('manager', 'expenses.approve', TENANT_A)).resolves.toBe(false);
    await expect(svc.hasPermission('manager', 'payroll.view', TENANT_A)).resolves.toBe(false);
  });

  it('tenant override can grant a permission beyond the global default', async () => {
    const svc = service({
      [`${TENANT_A}:${MANAGER_ROLE_ID}`]: [
        { permission_key: 'payroll.view', is_granted: true },
      ],
    });

    await expect(svc.hasPermission('manager', 'payroll.view', TENANT_A)).resolves.toBe(true);
  });

  it('zero override rows resolves identically to the pre-Stage-B global-only behavior', async () => {
    const svc = service({}); // no overrides for any tenant

    await expect(svc.hasPermission('manager', 'expenses.view', TENANT_A)).resolves.toBe(true);
    await expect(svc.hasPermission('manager', 'expenses.approve', TENANT_A)).resolves.toBe(true);
    await expect(svc.hasPermission('manager', 'payroll.view', TENANT_A)).resolves.toBe(false);
  });

  it('no cross-tenant leakage: tenant A override does not affect tenant B', async () => {
    const svc = service({
      [`${TENANT_A}:${MANAGER_ROLE_ID}`]: [
        { permission_key: 'expenses.approve', is_granted: false },
      ],
    });

    await expect(svc.hasPermission('manager', 'expenses.approve', TENANT_A)).resolves.toBe(false);
    await expect(svc.hasPermission('manager', 'expenses.approve', TENANT_B)).resolves.toBe(true);
  });

  it('multiple overrides in the same role are all applied (add and remove together)', async () => {
    const svc = service({
      [`${TENANT_A}:${MANAGER_ROLE_ID}`]: [
        { permission_key: 'expenses.approve', is_granted: false },
        { permission_key: 'payroll.view', is_granted: true },
      ],
    });

    await expect(svc.hasPermission('manager', 'expenses.view', TENANT_A)).resolves.toBe(true);
    await expect(svc.hasPermission('manager', 'expenses.approve', TENANT_A)).resolves.toBe(false);
    await expect(svc.hasPermission('manager', 'payroll.view', TENANT_A)).resolves.toBe(true);
  });

  it('REQUIRED: missing tenant context (tenantId null/undefined) never queries tenant_role_permissions and matches existing global behavior exactly', async () => {
    const overrideSpy: Record<string, { permission_key: string; is_granted: boolean }[]> = {
      // deliberately populated so the test would FAIL if the service
      // incorrectly queried tenant_role_permissions without a tenantId
      [`undefined:${MANAGER_ROLE_ID}`]: [
        { permission_key: 'expenses.view', is_granted: false },
      ],
    };
    const svc = service(overrideSpy);

    await expect(svc.hasPermission('manager', 'expenses.view', null)).resolves.toBe(true);
    await expect(svc.hasPermission('manager', 'expenses.approve')).resolves.toBe(true); // tenantId omitted entirely
    await expect(svc.hasPermission('manager', 'payroll.view', undefined)).resolves.toBe(false);
  });

  it('cache key format is tenant-scoped when tenantId is present, unscoped when absent', async () => {
    const supabase = buildFakeSupabase({
      globalGrants: { manager: ['expenses.view'] },
      systemRoleIds: { manager: MANAGER_ROLE_ID },
      overrides: {},
    });
    const cache = buildNoopCache();
    const svc = new PermissionsService(supabase as any, cache);

    await svc.hasPermission('manager', 'expenses.view', TENANT_A);
    await svc.hasPermission('manager', 'expenses.view', null);

    expect(cache.set).toHaveBeenCalledWith(
      `permissions:tenant:${TENANT_A}:role:manager`,
      expect.any(Array),
      600,
    );
    expect(cache.set).toHaveBeenCalledWith(
      'permissions:role:manager',
      expect.any(Array),
      600,
    );
  });

  it('cache hit short-circuits before any DB query (merged result is what gets cached)', async () => {
    const cache = buildNoopCache();
    (cache.get as jest.Mock).mockResolvedValueOnce(['expenses.view']); // pre-merged, cached value

    const supabase = {
      from: jest.fn(() => {
        throw new Error('DB should not be queried on a cache hit');
      }),
    };

    const svc = new PermissionsService(supabase as any, cache);
    await expect(svc.hasPermission('manager', 'expenses.view', TENANT_A)).resolves.toBe(true);
    expect(supabase.from).not.toHaveBeenCalled();
  });
});
