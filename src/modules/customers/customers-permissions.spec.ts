import { SupabaseClient } from '@supabase/supabase-js';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { PermissionsService } from '../../core/permissions/permissions.service';
import { RedisCacheService } from '../../core/cache/redis-cache.service';
import { REQUIRE_PERMISSION_KEY } from '../../core/permissions/require-permission.decorator';
import { CustomersController } from './customers.controller';

// Batch 1 Remediation 1 (Owner-approved) — the Batch 1 service-level tests
// (customers.service.spec.ts) exercise CustomersService directly and never
// touch PermissionGuard/PermissionsService at all, so they prove nothing
// about whether a caller without the right capability is actually turned
// away at the route. This file closes that gap by exercising the REAL
// PermissionGuard.canActivate() -> resolveUserPermission() ->
// PermissionsService chain (same construction style as the existing
// permission.guard.spec.ts), backed by a real PermissionsService wired to
// an in-memory fake Supabase — not a stubbed hasPermission() — so the
// role_permissions/tenant_role_permissions/user_permissions_override merge
// logic itself is genuinely exercised, not assumed.

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

// ---- Decorator-mapping proof (controller wiring) ----
describe('CustomersController — @RequirePermission wiring (Batch 1 Remediation 1)', () => {
  const getRequiredPermission = (methodName: keyof CustomersController) =>
    Reflect.getMetadata(
      REQUIRE_PERMISSION_KEY,
      CustomersController.prototype[methodName],
    );

  it('findAll (list) requires customers.view', () => {
    expect(getRequiredPermission('findAll')).toBe('customers.view');
  });

  it('findOne (read) requires customers.view', () => {
    expect(getRequiredPermission('findOne')).toBe('customers.view');
  });

  it('create requires customers.create', () => {
    expect(getRequiredPermission('create')).toBe('customers.create');
  });

  it('update requires customers.update', () => {
    expect(getRequiredPermission('update')).toBe('customers.update');
  });

  it('remove (archive) requires customers.archive', () => {
    expect(getRequiredPermission('remove')).toBe('customers.archive');
  });

  it('getHistory requires customers.view', () => {
    expect(getRequiredPermission('getHistory')).toBe('customers.view');
  });
});

// ---- Real authorization-stack tests ----

interface RolePermRow {
  role: string;
  permission_key: string;
  is_granted: boolean;
}
interface TenantOverrideRow {
  tenant_id: string;
  role_id: string;
  permission_key: string;
  is_granted: boolean;
}
interface UserOverrideRow {
  user_id: string;
  permission_key: string;
  action: 'GRANT' | 'DENY';
  is_active: boolean;
}
interface RoleRow {
  id: string;
  name: string;
  tenant_id: string | null;
}
interface UserRoleRow {
  user_id: string;
  role: { name: string };
}

function noopCache(): RedisCacheService {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    del: jest.fn().mockResolvedValue(undefined),
  } as unknown as RedisCacheService;
}

// Minimal in-memory fake matching only the exact query shapes
// PermissionsService actually issues — not a general-purpose Supabase mock.
function fakeSupabase(fixtures: {
  rolePermissions: RolePermRow[];
  tenantOverrides?: TenantOverrideRow[];
  userOverrides?: UserOverrideRow[];
  roles?: RoleRow[];
  userRoles?: UserRoleRow[];
}): SupabaseClient {
  const {
    rolePermissions,
    tenantOverrides = [],
    userOverrides = [],
    roles = [],
    userRoles = [],
  } = fixtures;

  const from = (table: string) => {
    const filters: [string, unknown][] = [];
    const builder = {
      select: () => builder,
      eq: (col: string, val: unknown) => {
        filters.push([col, val]);
        return builder;
      },
      is: (col: string, val: unknown) => {
        filters.push([col, val]);
        return builder;
      },
      maybeSingle: () => {
        const rows = applyFilters(table, filters);
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      },
      then: (resolve: (v: { data: unknown[]; error: null }) => void) => {
        resolve({ data: applyFilters(table, filters), error: null });
      },
    };
    return builder;
  };

  function applyFilters(
    table: string,
    filters: [string, unknown][],
  ): Record<string, unknown>[] {
    let rows: Record<string, unknown>[];
    if (table === 'role_permissions') rows = rolePermissions as any;
    else if (table === 'tenant_role_permissions') rows = tenantOverrides as any;
    else if (table === 'user_permissions_override') rows = userOverrides as any;
    else if (table === 'roles') rows = roles as any;
    else if (table === 'user_roles') rows = userRoles as any;
    else rows = [];

    return rows.filter((row) =>
      filters.every(([col, val]) => {
        if (val === null) return row[col] === null;
        return row[col] === val;
      }),
    );
  }

  return { from } as unknown as SupabaseClient;
}

function buildGuard(
  permissionsService: PermissionsService,
  permission: string,
) {
  return new PermissionGuard(
    { getAllAndOverride: () => permission } as any,
    permissionsService,
  );
}

function buildContext(user: Record<string, unknown>) {
  const request = { user };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as any;
}

describe('Customers — real PermissionGuard → PermissionsService stack (Batch 1 Remediation 1)', () => {
  it('1/2. user WITH customers.view (cashier) is allowed; user WITHOUT it (worker) is denied', async () => {
    const supabase = fakeSupabase({
      rolePermissions: [
        { role: 'cashier', permission_key: 'customers.view', is_granted: true },
      ],
    });
    const permissionsService = new PermissionsService(supabase, noopCache());
    const guard = buildGuard(permissionsService, 'customers.view');

    await expect(
      guard.canActivate(
        buildContext({ sub: 'u1', role: 'cashier', tenant_id: TENANT_A }),
      ),
    ).resolves.toBe(true);

    await expect(
      guard.canActivate(
        buildContext({ sub: 'u2', role: 'worker', tenant_id: TENANT_A }),
      ),
    ).rejects.toThrow('Permission denied: customers.view');
  });

  it('3/4. user WITH customers.create (cashier) allowed; WITHOUT (worker) denied', async () => {
    const supabase = fakeSupabase({
      rolePermissions: [
        {
          role: 'cashier',
          permission_key: 'customers.create',
          is_granted: true,
        },
      ],
    });
    const permissionsService = new PermissionsService(supabase, noopCache());
    const guard = buildGuard(permissionsService, 'customers.create');

    await expect(
      guard.canActivate(
        buildContext({ sub: 'u1', role: 'cashier', tenant_id: TENANT_A }),
      ),
    ).resolves.toBe(true);

    await expect(
      guard.canActivate(
        buildContext({ sub: 'u2', role: 'worker', tenant_id: TENANT_A }),
      ),
    ).rejects.toThrow('Permission denied: customers.create');
  });

  it('5/6. user WITH customers.update (manager) allowed; WITHOUT (worker) denied', async () => {
    const supabase = fakeSupabase({
      rolePermissions: [
        {
          role: 'manager',
          permission_key: 'customers.update',
          is_granted: true,
        },
      ],
    });
    const permissionsService = new PermissionsService(supabase, noopCache());
    const guard = buildGuard(permissionsService, 'customers.update');

    await expect(
      guard.canActivate(
        buildContext({ sub: 'u1', role: 'manager', tenant_id: TENANT_A }),
      ),
    ).resolves.toBe(true);

    await expect(
      guard.canActivate(
        buildContext({ sub: 'u2', role: 'worker', tenant_id: TENANT_A }),
      ),
    ).rejects.toThrow('Permission denied: customers.update');
  });

  it('7/8. user WITH customers.archive (manager) allowed; WITHOUT (worker) denied', async () => {
    const supabase = fakeSupabase({
      rolePermissions: [
        {
          role: 'manager',
          permission_key: 'customers.archive',
          is_granted: true,
        },
      ],
    });
    const permissionsService = new PermissionsService(supabase, noopCache());
    const guard = buildGuard(permissionsService, 'customers.archive');

    await expect(
      guard.canActivate(
        buildContext({ sub: 'u1', role: 'manager', tenant_id: TENANT_A }),
      ),
    ).resolves.toBe(true);

    await expect(
      guard.canActivate(
        buildContext({ sub: 'u2', role: 'worker', tenant_id: TENANT_A }),
      ),
    ).rejects.toThrow('Permission denied: customers.archive');
  });

  it('9. tenant-level override GRANTS customers.create to a role that otherwise lacks it', async () => {
    const supabase = fakeSupabase({
      rolePermissions: [], // worker has nothing globally
      roles: [{ id: 'role-1', name: 'worker', tenant_id: TENANT_A }],
      tenantOverrides: [
        {
          tenant_id: TENANT_A,
          role_id: 'role-1',
          permission_key: 'customers.create',
          is_granted: true,
        },
      ],
    });
    const permissionsService = new PermissionsService(supabase, noopCache());

    await expect(
      permissionsService.hasPermission('worker', 'customers.create', TENANT_A),
    ).resolves.toBe(true);
  });

  it('10. tenant-level override DENIES customers.create for a role that globally has it', async () => {
    const supabase = fakeSupabase({
      rolePermissions: [
        {
          role: 'cashier',
          permission_key: 'customers.create',
          is_granted: true,
        },
      ],
      roles: [{ id: 'role-2', name: 'cashier', tenant_id: TENANT_A }],
      tenantOverrides: [
        {
          tenant_id: TENANT_A,
          role_id: 'role-2',
          permission_key: 'customers.create',
          is_granted: false,
        },
      ],
    });
    const permissionsService = new PermissionsService(supabase, noopCache());

    await expect(
      permissionsService.hasPermission('cashier', 'customers.create', TENANT_A),
    ).resolves.toBe(false);
  });

  it('11. user-level GRANT override adds customers.archive for a specific user despite their role lacking it', async () => {
    const supabase = fakeSupabase({
      rolePermissions: [], // cashier has nothing globally in this fixture
      userRoles: [{ user_id: 'user-x', role: { name: 'cashier' } }],
      userOverrides: [
        {
          user_id: 'user-x',
          permission_key: 'customers.archive',
          action: 'GRANT',
          is_active: true,
        },
      ],
    });
    const permissionsService = new PermissionsService(supabase, noopCache());

    await expect(
      permissionsService.hasPermissionForUser(
        'user-x',
        'customers.archive',
        TENANT_A,
      ),
    ).resolves.toBe(true);
  });

  it('12. user-level DENY override removes customers.create for a specific user despite their role granting it', async () => {
    const supabase = fakeSupabase({
      rolePermissions: [
        {
          role: 'manager',
          permission_key: 'customers.create',
          is_granted: true,
        },
      ],
      userRoles: [{ user_id: 'user-y', role: { name: 'manager' } }],
      userOverrides: [
        {
          user_id: 'user-y',
          permission_key: 'customers.create',
          action: 'DENY',
          is_active: true,
        },
      ],
    });
    const permissionsService = new PermissionsService(supabase, noopCache());

    await expect(
      permissionsService.hasPermissionForUser(
        'user-y',
        'customers.create',
        TENANT_A,
      ),
    ).resolves.toBe(false);
  });

  it('13. old customers.view/customers.manage aliases still resolve for the roles that historically held them — the migration did not silently revoke access', async () => {
    // Mirrors the ACTUAL seeded state after this remediation: cashier holds
    // both the old alias keys and the new capability keys simultaneously.
    const supabase = fakeSupabase({
      rolePermissions: [
        { role: 'cashier', permission_key: 'customers.view', is_granted: true },
        {
          role: 'cashier',
          permission_key: 'customers.manage',
          is_granted: true,
        },
        {
          role: 'cashier',
          permission_key: 'customers.create',
          is_granted: true,
        },
        {
          role: 'cashier',
          permission_key: 'customers.update',
          is_granted: true,
        },
        {
          role: 'cashier',
          permission_key: 'customers.archive',
          is_granted: true,
        },
      ],
    });
    const permissionsService = new PermissionsService(supabase, noopCache());

    await expect(
      permissionsService.hasPermission('cashier', 'customers.view', TENANT_A),
    ).resolves.toBe(true);
    await expect(
      permissionsService.hasPermission('cashier', 'customers.manage', TENANT_A),
    ).resolves.toBe(true);
    await expect(
      permissionsService.hasPermission('cashier', 'customers.create', TENANT_A),
    ).resolves.toBe(true);
  });

  it('14. cross-tenant isolation — a tenant-level override in tenant A never affects tenant B', async () => {
    const supabase = fakeSupabase({
      rolePermissions: [], // worker has nothing globally
      roles: [
        { id: 'role-a', name: 'worker', tenant_id: TENANT_A },
        { id: 'role-b', name: 'worker', tenant_id: TENANT_B },
      ],
      tenantOverrides: [
        {
          tenant_id: TENANT_A,
          role_id: 'role-a',
          permission_key: 'customers.create',
          is_granted: true,
        },
      ],
    });
    const permissionsService = new PermissionsService(supabase, noopCache());

    await expect(
      permissionsService.hasPermission('worker', 'customers.create', TENANT_A),
    ).resolves.toBe(true);
    await expect(
      permissionsService.hasPermission('worker', 'customers.create', TENANT_B),
    ).resolves.toBe(false);
  });

  it('17. Central (owner) is force-granted every capability unconditionally, bypassing role_permissions entirely', async () => {
    const supabase = fakeSupabase({ rolePermissions: [] }); // deliberately empty
    const permissionsService = new PermissionsService(supabase, noopCache());
    const guard = buildGuard(permissionsService, 'customers.archive');

    await expect(
      guard.canActivate(
        buildContext({ sub: 'owner-1', role: 'owner', tenant_id: TENANT_A }),
      ),
    ).resolves.toBe(true);
  });
});
