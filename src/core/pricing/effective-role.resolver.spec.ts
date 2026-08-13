import { EffectiveRoleResolver } from './effective-role.resolver';

interface RoleFixture {
  id: string;
  name: string;
  priority: number;
  is_hierarchy_participant: boolean;
}

interface UserRoleFixture {
  is_primary: boolean;
  role: RoleFixture | null;
}

// Minimal fake Supabase client — only fixtures the single query
// resolveEffectiveRole() makes: user_roles JOIN roles.
function buildFakeSupabase(userRoles: Record<string, UserRoleFixture[]>) {
  return {
    from(table: string) {
      const builder: any = {
        _eqs: {} as Record<string, unknown>,
        select() {
          return builder;
        },
        eq(col: string, val: unknown) {
          builder._eqs[col] = val;
          return builder;
        },
        then(resolve: (v: unknown) => unknown) {
          if (table === 'user_roles') {
            const userId = builder._eqs['user_id'] as string;
            const rows = userRoles[userId] ?? [];
            return resolve({ data: rows, error: null });
          }
          throw new Error(`unfixtured table ${table}`);
        },
      };
      return builder;
    },
  };
}

function role(
  overrides: Partial<RoleFixture> & { id: string; name: string },
): RoleFixture {
  return {
    priority: 0,
    is_hierarchy_participant: true,
    ...overrides,
  };
}

const ROLES = {
  superadmin: role({ id: 'r-superadmin', name: 'superadmin', priority: 100 }),
  owner: role({ id: 'r-owner', name: 'owner', priority: 90 }),
  manager: role({ id: 'r-manager', name: 'manager', priority: 70 }),
  cashier: role({ id: 'r-cashier', name: 'cashier', priority: 50 }),
  inventory_clerk: role({
    id: 'r-inv-clerk',
    name: 'inventory_clerk',
    priority: 50,
  }),
  worker: role({ id: 'r-worker', name: 'worker', priority: 30 }),
  none: role({ id: 'r-none', name: 'none', priority: 0 }),
  customParticipant: role({
    id: 'r-custom-80',
    name: 'custom_80',
    priority: 80,
  }),
  customNonParticipant: role({
    id: 'r-custom-np',
    name: 'custom_np',
    priority: 0,
    is_hierarchy_participant: false,
  }),
};

function makeResolver(
  userRoles: Record<string, UserRoleFixture[]>,
): EffectiveRoleResolver {
  return new EffectiveRoleResolver(buildFakeSupabase(userRoles) as any);
}

describe('EffectiveRoleResolver.resolveEffectiveRole', () => {
  describe('single role', () => {
    it('owner', async () => {
      const resolver = makeResolver({
        u1: [{ is_primary: true, role: ROLES.owner }],
      });
      expect(await resolver.resolveEffectiveRole('u1')).toEqual({
        roleId: 'r-owner',
        roleName: 'owner',
        priority: 90,
      });
    });

    it('manager', async () => {
      const resolver = makeResolver({
        u1: [{ is_primary: true, role: ROLES.manager }],
      });
      expect(await resolver.resolveEffectiveRole('u1')).toEqual({
        roleId: 'r-manager',
        roleName: 'manager',
        priority: 70,
      });
    });

    it('cashier', async () => {
      const resolver = makeResolver({
        u1: [{ is_primary: true, role: ROLES.cashier }],
      });
      expect(await resolver.resolveEffectiveRole('u1')).toEqual({
        roleId: 'r-cashier',
        roleName: 'cashier',
        priority: 50,
      });
    });

    it('worker', async () => {
      const resolver = makeResolver({
        u1: [{ is_primary: true, role: ROLES.worker }],
      });
      expect(await resolver.resolveEffectiveRole('u1')).toEqual({
        roleId: 'r-worker',
        roleName: 'worker',
        priority: 30,
      });
    });

    it('none', async () => {
      const resolver = makeResolver({
        u1: [{ is_primary: true, role: ROLES.none }],
      });
      expect(await resolver.resolveEffectiveRole('u1')).toEqual({
        roleId: 'r-none',
        roleName: 'none',
        priority: 0,
      });
    });

    it('custom participant', async () => {
      const resolver = makeResolver({
        u1: [{ is_primary: true, role: ROLES.customParticipant }],
      });
      expect(await resolver.resolveEffectiveRole('u1')).toEqual({
        roleId: 'r-custom-80',
        roleName: 'custom_80',
        priority: 80,
      });
    });

    it('custom non-participant -> null', async () => {
      const resolver = makeResolver({
        u1: [{ is_primary: true, role: ROLES.customNonParticipant }],
      });
      expect(await resolver.resolveEffectiveRole('u1')).toBeNull();
    });
  });

  describe('multiple roles', () => {
    it('manager + cashier -> manager (higher priority)', async () => {
      const resolver = makeResolver({
        u1: [
          { is_primary: true, role: ROLES.manager },
          { is_primary: false, role: ROLES.cashier },
        ],
      });
      expect((await resolver.resolveEffectiveRole('u1'))?.roleName).toBe(
        'manager',
      );
    });

    it('cashier + inventory_clerk, exactly one primary -> that primary', async () => {
      const resolver = makeResolver({
        u1: [
          { is_primary: true, role: ROLES.cashier },
          { is_primary: false, role: ROLES.inventory_clerk },
        ],
      });
      expect((await resolver.resolveEffectiveRole('u1'))?.roleName).toBe(
        'cashier',
      );
    });

    it('cashier + inventory_clerk, both primary -> null', async () => {
      const resolver = makeResolver({
        u1: [
          { is_primary: true, role: ROLES.cashier },
          { is_primary: true, role: ROLES.inventory_clerk },
        ],
      });
      expect(await resolver.resolveEffectiveRole('u1')).toBeNull();
    });

    it('cashier + inventory_clerk, no primary -> null', async () => {
      const resolver = makeResolver({
        u1: [
          { is_primary: false, role: ROLES.cashier },
          { is_primary: false, role: ROLES.inventory_clerk },
        ],
      });
      expect(await resolver.resolveEffectiveRole('u1')).toBeNull();
    });

    it('manager + custom priority 80 -> custom', async () => {
      const resolver = makeResolver({
        u1: [
          { is_primary: true, role: ROLES.manager },
          { is_primary: false, role: ROLES.customParticipant },
        ],
      });
      expect((await resolver.resolveEffectiveRole('u1'))?.roleName).toBe(
        'custom_80',
      );
    });

    it('superadmin + owner -> owner (superadmin excluded)', async () => {
      const resolver = makeResolver({
        u1: [
          { is_primary: true, role: ROLES.superadmin },
          { is_primary: false, role: ROLES.owner },
        ],
      });
      expect((await resolver.resolveEffectiveRole('u1'))?.roleName).toBe(
        'owner',
      );
    });

    it('superadmin only -> null', async () => {
      const resolver = makeResolver({
        u1: [{ is_primary: true, role: ROLES.superadmin }],
      });
      expect(await resolver.resolveEffectiveRole('u1')).toBeNull();
    });

    it('unclassified (non-participant) only -> null', async () => {
      const resolver = makeResolver({
        u1: [{ is_primary: true, role: ROLES.customNonParticipant }],
      });
      expect(await resolver.resolveEffectiveRole('u1')).toBeNull();
    });
  });

  describe('mutation reflection (no caching — every call re-reads the fixture)', () => {
    it('priority change is reflected immediately', async () => {
      const bumpedCashier = role({ ...ROLES.cashier, priority: 95 });
      const resolver = makeResolver({
        u1: [
          { is_primary: true, role: ROLES.manager },
          { is_primary: false, role: bumpedCashier },
        ],
      });
      expect((await resolver.resolveEffectiveRole('u1'))?.roleName).toBe(
        'cashier',
      );
    });

    it('participant toggle is reflected immediately', async () => {
      const demoted = role({
        ...ROLES.customParticipant,
        is_hierarchy_participant: false,
      });
      const resolver = makeResolver({
        u1: [{ is_primary: true, role: demoted }],
      });
      expect(await resolver.resolveEffectiveRole('u1')).toBeNull();
    });

    it('add/remove role is reflected immediately (empty set -> null)', async () => {
      const resolver = makeResolver({ u1: [] });
      expect(await resolver.resolveEffectiveRole('u1')).toBeNull();
    });
  });

  it('no eligible roles at all -> null', async () => {
    const resolver = makeResolver({ u1: [] });
    expect(await resolver.resolveEffectiveRole('u1')).toBeNull();
  });
});
