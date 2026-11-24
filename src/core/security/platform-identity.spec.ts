import {
  buildRoleClaims,
  isOwnerOrPlatformAdmin,
  isPlatformAdmin,
  isReservedRoleName,
  isTenantOwner,
  normalizeRoleName,
  selectEffectiveRoleIds,
  RESERVED_ROLE_NAMES,
  SYSTEM_ROLE_NAMES,
} from './platform-identity';

const ZWSP = String.fromCharCode(0x200b); // zero-width space
const ZWJ = String.fromCharCode(0x200d); // zero-width joiner
const SHY = String.fromCharCode(0xad); // soft hyphen

const TENANT = 'tenant-a';

describe('normalizeRoleName (R-01 name folding)', () => {
  it.each([
    ['superadmin', 'superadmin'],
    ['SuperAdmin', 'superadmin'],
    ['  super admin  ', 'superadmin'],
    ['super_admin', 'superadmin'],
    ['super-admin', 'superadmin'],
    ['super.admin', 'superadmin'],
    ['ｓｕｐｅｒａｄｍｉｎ', 'superadmin'], // full-width
    [`super${ZWSP}admin`, 'superadmin'], // zero-width space
    [`super${SHY}admin`, 'superadmin'], // soft hyphen
    ['superadmín', 'superadmin'], // combining/precomposed accent
    ['sυperadmin', 'superadmin'], // Greek upsilon
    ['ѕuperadmin', 'superadmin'], // Cyrillic dze
    ['оwner', 'owner'], // Cyrillic o
    ['Inventory Clerk', 'inventoryclerk'],
    ['inventory_clerk', 'inventoryclerk'],
  ])('folds %j to %j', (input, expected) => {
    expect(normalizeRoleName(input)).toBe(expected);
  });

  it('returns an empty string for names that normalise to nothing', () => {
    expect(normalizeRoleName(`${ZWSP} ${ZWJ}`)).toBe('');
    expect(normalizeRoleName('')).toBe('');
  });
});

describe('isReservedRoleName', () => {
  it.each([...RESERVED_ROLE_NAMES])(
    'reserves %s and its look-alikes',
    (name) => {
      expect(isReservedRoleName(name)).toBe(true);
      expect(isReservedRoleName(name.toUpperCase())).toBe(true);
      expect(isReservedRoleName(` ${name} `)).toBe(true);
    },
  );

  it('reserves every system role name', () => {
    for (const n of SYSTEM_ROLE_NAMES) expect(isReservedRoleName(n)).toBe(true);
  });

  it('honours extra (live) global role names', () => {
    expect(isReservedRoleName('Franchise Admin')).toBe(false);
    expect(isReservedRoleName('Franchise Admin', ['franchise_admin'])).toBe(
      true,
    );
  });

  it.each([
    'Supervisor',
    'Shift Lead',
    'Accountant',
    'Cashier Trainee',
    'Owners Club',
  ])('does not reserve the legitimate custom name %s', (name) => {
    expect(isReservedRoleName(name)).toBe(false);
  });
});

describe('isPlatformAdmin (the single platform decision)', () => {
  it('true for a tenant-less identity with the platform claim', () => {
    expect(isPlatformAdmin({ platform_admin: true, tenant_id: null })).toBe(
      true,
    );
  });

  it('true for a legacy token (no claim) naming superadmin when it has NO tenant', () => {
    expect(
      isPlatformAdmin({
        role: 'superadmin',
        roles: ['superadmin'],
        tenant_id: null,
      }),
    ).toBe(true);
    expect(isPlatformAdmin({ role: 'superadmin' })).toBe(true);
  });

  it('false for a tenant user, whatever name the roles carry (forged / look-alike role)', () => {
    expect(
      isPlatformAdmin({
        role: 'owner',
        roles: ['owner', 'superadmin'],
        tenant_id: TENANT,
      }),
    ).toBe(false);
    expect(
      isPlatformAdmin({
        role: 'superadmin',
        roles: ['superadmin'],
        tenant_id: TENANT,
      }),
    ).toBe(false);
    expect(isPlatformAdmin({ platform_admin: true, tenant_id: TENANT })).toBe(
      false,
    );
  });

  it('false when the claim is explicitly false even if a role name says otherwise', () => {
    expect(
      isPlatformAdmin({
        platform_admin: false,
        roles: ['superadmin'],
        tenant_id: null,
      }),
    ).toBe(false);
  });

  it('false for missing/empty identities', () => {
    expect(isPlatformAdmin(undefined)).toBe(false);
    expect(isPlatformAdmin(null)).toBe(false);
    expect(isPlatformAdmin({})).toBe(false);
    expect(
      isPlatformAdmin({ role: 'cashier', roles: ['cashier'], tenant_id: null }),
    ).toBe(false);
  });
});

describe('isTenantOwner / isOwnerOrPlatformAdmin', () => {
  it('owner is decided from the sanitised roles claim', () => {
    expect(isTenantOwner({ roles: ['owner'], tenant_id: TENANT })).toBe(true);
    expect(isTenantOwner({ role: 'owner' })).toBe(true);
    expect(isTenantOwner({ roles: ['manager'], tenant_id: TENANT })).toBe(
      false,
    );
    expect(isTenantOwner({ roles: ['superadmin'], tenant_id: TENANT })).toBe(
      false,
    );
  });

  it('central admin = owner or platform admin', () => {
    expect(
      isOwnerOrPlatformAdmin({ roles: ['owner'], tenant_id: TENANT }),
    ).toBe(true);
    expect(
      isOwnerOrPlatformAdmin({ platform_admin: true, tenant_id: null }),
    ).toBe(true);
    expect(
      isOwnerOrPlatformAdmin({ roles: ['manager'], tenant_id: TENANT }),
    ).toBe(false);
    expect(
      isOwnerOrPlatformAdmin({ roles: ['superadmin'], tenant_id: TENANT }),
    ).toBe(false);
  });
});

describe('buildRoleClaims (token claims from user_roles rows)', () => {
  it('passes global role names through', () => {
    const c = buildRoleClaims([{ name: 'owner', tenant_id: null }], {
      role: 'owner',
      tenant_id: TENANT,
    });
    expect(c).toEqual({ roles: ['owner'], platform_admin: false });
  });

  it('keeps legitimate custom role names, drops reserved look-alikes', () => {
    const c = buildRoleClaims(
      [
        { name: 'Supervisor', tenant_id: TENANT },
        { name: 'superadmin', tenant_id: TENANT }, // forged look-alike
        { name: 'Owner', tenant_id: TENANT }, // forged look-alike
        { name: 'manager', tenant_id: TENANT }, // collides with system role
      ],
      { role: 'none', tenant_id: TENANT },
    );
    expect(c.roles).toEqual(['Supervisor']);
    expect(c.platform_admin).toBe(false);
  });

  it('platform admin only for a tenant-less holder of the GLOBAL superadmin role', () => {
    expect(
      buildRoleClaims([{ name: 'superadmin', tenant_id: null }], {
        role: 'superadmin',
        tenant_id: null,
      }),
    ).toEqual({ roles: ['superadmin'], platform_admin: true });
    // legacy mirror only (no user_roles row) still works for a tenant-less user
    expect(
      buildRoleClaims([], { role: 'superadmin', tenant_id: null }),
    ).toEqual({
      roles: ['superadmin'],
      platform_admin: true,
    });
  });

  it('a tenant user holding the global superadmin row (bad data) never becomes platform', () => {
    const c = buildRoleClaims([{ name: 'superadmin', tenant_id: null }], {
      role: 'owner',
      tenant_id: TENANT,
    });
    expect(c.platform_admin).toBe(false);
    expect(c.roles).not.toContain('superadmin');
  });

  it('a tenant user whose legacy role mirror says superadmin (bad data) never becomes platform', () => {
    const c = buildRoleClaims([], { role: 'superadmin', tenant_id: TENANT });
    expect(c.platform_admin).toBe(false);
    expect(c.roles).not.toContain('superadmin');
  });

  it('falls back to the legacy role when there are no rows', () => {
    expect(buildRoleClaims([], { role: 'cashier', tenant_id: TENANT })).toEqual(
      {
        roles: ['cashier'],
        platform_admin: false,
      },
    );
  });

  it('rows with an unknown tenant scope (undefined) are treated as tenant-scoped (fail closed)', () => {
    const c = buildRoleClaims(
      [{ name: 'owner', tenant_id: undefined as unknown as string | null }],
      { role: 'cashier', tenant_id: TENANT },
    );
    expect(c.roles).not.toContain('owner');
  });
});

describe('selectEffectiveRoleIds (R-DOC-01)', () => {
  const T = 'tenant-a';
  it('keeps global roles and own non-reserved tenant roles', () => {
    expect(
      selectEffectiveRoleIds(
        [
          { id: '1', name: 'manager', tenant_id: null },
          { id: '2', name: 'Supervisor', tenant_id: T },
        ],
        T,
      ),
    ).toEqual(['1', '2']);
  });
  it.each([
    'manager',
    'Manager',
    'MANAGER',
    `m${String.fromCharCode(0x0430)}nager`,
    `man${String.fromCharCode(0x200b)}ager`,
    'man_ager',
    'ADMIN',
    'superadmin',
  ])('drops a tenant look-alike %j', (name) => {
    expect(selectEffectiveRoleIds([{ id: 'x', name, tenant_id: T }], T)).toEqual(
      [],
    );
  });
  it("drops another tenant's roles and malformed rows", () => {
    expect(
      selectEffectiveRoleIds(
        [
          { id: 'x', name: 'Supervisor', tenant_id: 'tenant-b' },
          { id: '', name: 'a', tenant_id: null },
          { id: 'y', name: '', tenant_id: null },
        ],
        T,
      ),
    ).toEqual([]);
  });
});
