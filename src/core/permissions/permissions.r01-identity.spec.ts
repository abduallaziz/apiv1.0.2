import { PermissionsService } from './permissions.service';

/**
 * R-01 — roles are resolved by IDENTITY (id + owning tenant), not by name.
 * A tenant role that merely shares a system role's name must not inherit the
 * system role's global grants, and only the GLOBAL owner role gets the
 * "everything" bypass.
 */
const TENANT = 'tenant-a';
const OTHER = 'tenant-b';

type Tables = {
  user_roles: {
    role: { id: string; name: string; tenant_id: string | null };
  }[];
  role_permissions: { role: string; permission_key: string }[];
  tenant_role_permissions: {
    tenant_id: string;
    role_id: string;
    permission_key: string;
    is_granted: boolean;
  }[];
  roles: { id: string; name: string; tenant_id: string | null }[];
  permissions: { name: string; resource: string }[];
};

function supabaseOver(t: Tables) {
  return {
    from(table: keyof Tables | 'user_permissions_override') {
      const filters: Record<string, unknown> = {};
      const q: any = {
        select: () => q,
        eq: (c: string, v: unknown) => ((filters[c] = v), q),
        is: (c: string, v: unknown) => ((filters[`is:${c}`] = v), q),
        neq: () => q,
        maybeSingle: () => {
          const rows = (t.roles as any[]).filter(
            (r) =>
              (filters.name === undefined || r.name === filters.name) &&
              (filters['is:tenant_id'] === undefined ||
                r.tenant_id === filters['is:tenant_id']) &&
              (filters.tenant_id === undefined ||
                r.tenant_id === filters.tenant_id),
          );
          return Promise.resolve({ data: rows[0] ?? null, error: null });
        },
        then: (res: (v: unknown) => unknown) => {
          let data: any[] = [];
          if (table === 'user_roles') data = t.user_roles;
          else if (table === 'role_permissions')
            data = t.role_permissions.filter((r) => r.role === filters.role);
          else if (table === 'tenant_role_permissions')
            data = t.tenant_role_permissions.filter(
              (r) =>
                r.tenant_id === filters.tenant_id &&
                r.role_id === filters.role_id,
            );
          else if (table === 'permissions') data = t.permissions;
          else if (table === 'user_permissions_override') data = [];
          return Promise.resolve({ data, error: null }).then(res);
        },
      };
      return q;
    },
  };
}

const cache = {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn(),
  del: jest.fn(),
};

function service(t: Tables) {
  return new PermissionsService(supabaseOver(t) as never, cache as never);
}

const GLOBAL_MANAGER_GRANTS = [
  { role: 'manager', permission_key: 'expenses.approve' },
  { role: 'manager', permission_key: 'users.manage' },
];

describe('PermissionsService.hasPermissionForUser — identity based (R-01)', () => {
  it('a tenant role named "manager" does NOT inherit the system manager grants', async () => {
    const svc = service({
      user_roles: [
        { role: { id: 'r-fake', name: 'manager', tenant_id: TENANT } },
      ],
      role_permissions: GLOBAL_MANAGER_GRANTS,
      tenant_role_permissions: [],
      roles: [
        { id: 'r-sys-manager', name: 'manager', tenant_id: null },
        { id: 'r-fake', name: 'manager', tenant_id: TENANT },
      ],
      permissions: [],
    });
    expect(
      await svc.hasPermissionForUser('u1', 'expenses.approve', TENANT),
    ).toBe(false);
    expect(await svc.hasPermissionForUser('u1', 'users.manage', TENANT)).toBe(
      false,
    );
  });

  it('the real system manager role keeps its grants (no regression)', async () => {
    const svc = service({
      user_roles: [
        { role: { id: 'r-sys-manager', name: 'manager', tenant_id: null } },
      ],
      role_permissions: GLOBAL_MANAGER_GRANTS,
      tenant_role_permissions: [],
      roles: [{ id: 'r-sys-manager', name: 'manager', tenant_id: null }],
      permissions: [],
    });
    expect(
      await svc.hasPermissionForUser('u1', 'expenses.approve', TENANT),
    ).toBe(true);
    expect(
      await svc.hasPermissionForUser('u1', 'inventory.delete', TENANT),
    ).toBe(false);
  });

  it('a tenant role named "owner" does not get the owner bypass; the global owner does', async () => {
    const fake = service({
      user_roles: [
        { role: { id: 'r-fake', name: 'owner', tenant_id: TENANT } },
      ],
      role_permissions: [],
      tenant_role_permissions: [],
      roles: [],
      permissions: [{ name: 'expenses.approve', resource: 'expenses' }],
    });
    expect(
      await fake.hasPermissionForUser('u1', 'expenses.approve', TENANT),
    ).toBe(false);

    const real = service({
      user_roles: [{ role: { id: 'r-owner', name: 'owner', tenant_id: null } }],
      role_permissions: [],
      tenant_role_permissions: [],
      roles: [],
      permissions: [],
    });
    expect(
      await real.hasPermissionForUser('u1', 'anything.at.all', TENANT),
    ).toBe(true);
  });

  it('a legitimate custom role gets exactly the permissions granted to it', async () => {
    const svc = service({
      user_roles: [
        { role: { id: 'r-sup', name: 'Supervisor', tenant_id: TENANT } },
      ],
      role_permissions: [],
      tenant_role_permissions: [
        {
          tenant_id: TENANT,
          role_id: 'r-sup',
          permission_key: 'sales.view',
          is_granted: true,
        },
        {
          tenant_id: TENANT,
          role_id: 'r-sup',
          permission_key: 'sales.refund',
          is_granted: false,
        },
      ],
      roles: [{ id: 'r-sup', name: 'Supervisor', tenant_id: TENANT }],
      permissions: [],
    });
    expect(await svc.hasPermissionForUser('u1', 'sales.view', TENANT)).toBe(
      true,
    );
    expect(await svc.hasPermissionForUser('u1', 'sales.refund', TENANT)).toBe(
      false,
    );
  });

  it('platform-only permissions on a tenant role (old rows) are never granted', async () => {
    const svc = service({
      user_roles: [
        { role: { id: 'r-sup', name: 'Supervisor', tenant_id: TENANT } },
      ],
      role_permissions: [],
      tenant_role_permissions: [
        {
          tenant_id: TENANT,
          role_id: 'r-sup',
          permission_key: 'analytics.view.all',
          is_granted: true,
        },
        {
          tenant_id: TENANT,
          role_id: 'r-sup',
          permission_key: 'superadmin.tenants.manage',
          is_granted: true,
        },
        {
          tenant_id: TENANT,
          role_id: 'r-sup',
          permission_key: 'sales.view',
          is_granted: true,
        },
      ],
      roles: [],
      permissions: [],
    });
    expect(
      await svc.hasPermissionForUser('u1', 'analytics.view.all', TENANT),
    ).toBe(false);
    expect(
      await svc.hasPermissionForUser('u1', 'superadmin.tenants.manage', TENANT),
    ).toBe(false);
    expect(await svc.hasPermissionForUser('u1', 'sales.view', TENANT)).toBe(
      true,
    );
  });

  it("another tenant's role grants nothing in this tenant", async () => {
    const svc = service({
      user_roles: [
        { role: { id: 'r-b', name: 'Supervisor', tenant_id: OTHER } },
      ],
      role_permissions: [],
      tenant_role_permissions: [
        {
          tenant_id: OTHER,
          role_id: 'r-b',
          permission_key: 'sales.view',
          is_granted: true,
        },
      ],
      roles: [],
      permissions: [],
    });
    expect(await svc.hasPermissionForUser('u1', 'sales.view', TENANT)).toBe(
      false,
    );
  });
});
