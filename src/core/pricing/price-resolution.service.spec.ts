import {
  PriceResolutionService,
  PriceResolutionInput,
} from './price-resolution.service';
import { EffectiveRole } from './effective-role.resolver';

interface ItemFixture {
  price: number;
  is_active: boolean;
  deleted_at: string | null;
}

interface VariantFixture {
  item_id: string;
  price_adjustment: number;
  is_active: boolean;
}

interface PolicyFixture {
  branch_id: string | null;
  role_id: string | null;
  allow_discount?: boolean | null;
  allow_increase?: boolean | null;
  allow_combine_with_discount?: boolean | null;
  max_discount_percent?: number | null;
  max_increase_percent?: number | null;
  reason_policy?:
    | 'not_required'
    | 'always_required'
    | 'required_above_threshold'
    | 'optional'
    | null;
  reason_threshold_percent?: number | null;
  allow_zero_price?: boolean | null;
  zero_price_requires_permission?: boolean | null;
  zero_price_requires_reason?: boolean | null;
}

function policyRow(overrides: PolicyFixture): PolicyFixture {
  return {
    allow_discount: null,
    allow_increase: null,
    allow_combine_with_discount: null,
    max_discount_percent: null,
    max_increase_percent: null,
    reason_policy: null,
    reason_threshold_percent: null,
    allow_zero_price: null,
    zero_price_requires_permission: null,
    zero_price_requires_reason: null,
    ...overrides,
  };
}

// Minimal fake Supabase client — fixtures only the 3 tables
// PriceResolutionService reads: items, item_variants, price_override_policies.
function buildFakeSupabase(fixtures: {
  items?: Record<string, ItemFixture>;
  variants?: Record<string, VariantFixture>;
  policies?: PolicyFixture[];
}) {
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
        async maybeSingle() {
          if (table === 'items') {
            const row = fixtures.items?.[builder._eqs['id'] as string];
            return { data: row ?? null, error: null };
          }
          if (table === 'item_variants') {
            const row = fixtures.variants?.[builder._eqs['id'] as string];
            return { data: row ?? null, error: null };
          }
          throw new Error(`maybeSingle not fixtured for table ${table}`);
        },
        then(resolve: (v: unknown) => unknown) {
          if (table === 'price_override_policies') {
            return resolve({ data: fixtures.policies ?? [], error: null });
          }
          throw new Error(`unfixtured table ${table}`);
        },
      };
      return builder;
    },
  };
}

function buildFakePermissionsService(granted: boolean) {
  return { hasPermissionForUser: jest.fn().mockResolvedValue(granted) };
}

function buildFakeEffectiveRoleResolver(role: EffectiveRole | null) {
  return { resolveEffectiveRole: jest.fn().mockResolvedValue(role) };
}

const OWNER_ROLE: EffectiveRole = {
  roleId: 'r-owner',
  roleName: 'owner',
  priority: 90,
};

function makeService(opts: {
  items?: Record<string, ItemFixture>;
  variants?: Record<string, VariantFixture>;
  policies?: PolicyFixture[];
  permissionGranted?: boolean;
  effectiveRole?: EffectiveRole | null;
}): {
  service: PriceResolutionService;
  permissions: ReturnType<typeof buildFakePermissionsService>;
  roleResolver: ReturnType<typeof buildFakeEffectiveRoleResolver>;
} {
  const permissions = buildFakePermissionsService(
    opts.permissionGranted ?? true,
  );
  const roleResolver = buildFakeEffectiveRoleResolver(
    opts.effectiveRole === undefined ? OWNER_ROLE : opts.effectiveRole,
  );
  const supabase = buildFakeSupabase({
    items: opts.items,
    variants: opts.variants,
    policies: opts.policies,
  });
  const service = new PriceResolutionService(
    supabase as any,
    permissions as any,
    roleResolver as any,
  );
  return { service, permissions, roleResolver };
}

const BASE_INPUT: Omit<PriceResolutionInput, 'requestedUnitPrice'> = {
  userId: 'u1',
  tenantId: 't1',
  branchId: 'b1',
  itemId: 'item-1',
  hasInvoiceLevelDiscount: false,
};

const TENANT_PERMISSIVE_POLICY: PolicyFixture = policyRow({
  branch_id: null,
  role_id: null,
  allow_discount: true,
  allow_increase: true,
  allow_combine_with_discount: true,
  max_discount_percent: 50,
  max_increase_percent: 50,
  reason_policy: 'not_required',
  allow_zero_price: true,
});

describe('PriceResolutionService.resolvePrice', () => {
  describe('Normal Sale', () => {
    it('requested === official -> no_override, no policy/permission/role calls', async () => {
      const { service, permissions, roleResolver } = makeService({
        items: { 'item-1': { price: 100, is_active: true, deleted_at: null } },
      });
      const result = await service.resolvePrice({
        ...BASE_INPUT,
        requestedUnitPrice: 100,
      });
      expect(result).toEqual({ kind: 'no_override', officialUnitPrice: 100 });
      expect(permissions.hasPermissionForUser).not.toHaveBeenCalled();
      expect(roleResolver.resolveEffectiveRole).not.toHaveBeenCalled();
    });
  });

  describe('Official = 0', () => {
    it('official=0, requested=0 -> no_override', async () => {
      const { service, permissions } = makeService({
        items: { 'item-1': { price: 0, is_active: true, deleted_at: null } },
      });
      const result = await service.resolvePrice({
        ...BASE_INPUT,
        requestedUnitPrice: 0,
      });
      expect(result).toEqual({ kind: 'no_override', officialUnitPrice: 0 });
      expect(permissions.hasPermissionForUser).not.toHaveBeenCalled();
    });

    it('official=0, requested>0 -> rejected, short-circuits before role/permission/policy', async () => {
      const { service, permissions, roleResolver } = makeService({
        items: { 'item-1': { price: 0, is_active: true, deleted_at: null } },
      });
      const result = await service.resolvePrice({
        ...BASE_INPUT,
        requestedUnitPrice: 10,
      });
      expect(result).toEqual({
        kind: 'rejected',
        officialUnitPrice: 0,
        requestedUnitPrice: 10,
        reasonCode: 'official_price_zero_increase_not_supported',
      });
      expect(permissions.hasPermissionForUser).not.toHaveBeenCalled();
      expect(roleResolver.resolveEffectiveRole).not.toHaveBeenCalled();
    });
  });

  describe('Discount', () => {
    it('allowed within limit -> approved', async () => {
      const { service } = makeService({
        items: { 'item-1': { price: 100, is_active: true, deleted_at: null } },
        policies: [TENANT_PERMISSIVE_POLICY],
      });
      const result = await service.resolvePrice({
        ...BASE_INPUT,
        requestedUnitPrice: 80,
      });
      expect(result).toMatchObject({
        kind: 'approved',
        direction: 'discount',
        differenceAmount: 20,
        differencePercent: 20,
        approvedUnitPrice: 80,
      });
    });

    it('allow_discount not true -> rejected discount_not_allowed', async () => {
      const { service } = makeService({
        items: { 'item-1': { price: 100, is_active: true, deleted_at: null } },
        policies: [
          policyRow({ branch_id: null, role_id: null, allow_discount: false }),
        ],
      });
      const result = await service.resolvePrice({
        ...BASE_INPUT,
        requestedUnitPrice: 80,
      });
      expect(result).toMatchObject({
        kind: 'rejected',
        reasonCode: 'discount_not_allowed',
      });
    });

    it('limit exceeded -> rejected limit_exceeded', async () => {
      const { service } = makeService({
        items: { 'item-1': { price: 100, is_active: true, deleted_at: null } },
        policies: [
          policyRow({
            branch_id: null,
            role_id: null,
            allow_discount: true,
            max_discount_percent: 10,
          }),
        ],
      });
      const result = await service.resolvePrice({
        ...BASE_INPUT,
        requestedUnitPrice: 50,
      });
      expect(result).toMatchObject({
        kind: 'rejected',
        reasonCode: 'limit_exceeded',
      });
    });

    it('max_discount_percent NULL after inheritance -> rejected limit_exceeded (fail-closed)', async () => {
      const { service } = makeService({
        items: { 'item-1': { price: 100, is_active: true, deleted_at: null } },
        policies: [
          policyRow({ branch_id: null, role_id: null, allow_discount: true }),
        ],
      });
      const result = await service.resolvePrice({
        ...BASE_INPUT,
        requestedUnitPrice: 80,
      });
      expect(result).toMatchObject({
        kind: 'rejected',
        reasonCode: 'limit_exceeded',
      });
    });

    it('reason required (always_required) and missing -> rejected reason_required', async () => {
      const { service } = makeService({
        items: { 'item-1': { price: 100, is_active: true, deleted_at: null } },
        policies: [
          policyRow({
            branch_id: null,
            role_id: null,
            allow_discount: true,
            max_discount_percent: 50,
            reason_policy: 'always_required',
          }),
        ],
      });
      const result = await service.resolvePrice({
        ...BASE_INPUT,
        requestedUnitPrice: 80,
      });
      expect(result).toMatchObject({
        kind: 'rejected',
        reasonCode: 'reason_required',
      });
    });

    it('reason required above threshold, exceeded, missing -> rejected reason_required', async () => {
      const { service } = makeService({
        items: { 'item-1': { price: 100, is_active: true, deleted_at: null } },
        policies: [
          policyRow({
            branch_id: null,
            role_id: null,
            allow_discount: true,
            max_discount_percent: 50,
            reason_policy: 'required_above_threshold',
            reason_threshold_percent: 10,
          }),
        ],
      });
      const result = await service.resolvePrice({
        ...BASE_INPUT,
        requestedUnitPrice: 80,
      }); // 20% > 10%
      expect(result).toMatchObject({
        kind: 'rejected',
        reasonCode: 'reason_required',
      });
    });

    it('reason below threshold, no reason given -> approved', async () => {
      const { service } = makeService({
        items: { 'item-1': { price: 100, is_active: true, deleted_at: null } },
        policies: [
          policyRow({
            branch_id: null,
            role_id: null,
            allow_discount: true,
            max_discount_percent: 50,
            reason_policy: 'required_above_threshold',
            reason_threshold_percent: 30,
          }),
        ],
      });
      const result = await service.resolvePrice({
        ...BASE_INPUT,
        requestedUnitPrice: 80,
      }); // 20% <= 30%
      expect(result).toMatchObject({ kind: 'approved' });
    });

    it('zero price (official>0, requested=0), allow_zero_price=false -> rejected zero_price_not_allowed', async () => {
      const { service } = makeService({
        items: { 'item-1': { price: 100, is_active: true, deleted_at: null } },
        policies: [
          policyRow({
            branch_id: null,
            role_id: null,
            allow_discount: true,
            max_discount_percent: 100,
            allow_zero_price: false,
          }),
        ],
      });
      const result = await service.resolvePrice({
        ...BASE_INPUT,
        requestedUnitPrice: 0,
      });
      expect(result).toMatchObject({
        kind: 'rejected',
        reasonCode: 'zero_price_not_allowed',
      });
    });

    it('zero price allowed but exceeds max_discount_percent -> rejected limit_exceeded (no bypass)', async () => {
      const { service } = makeService({
        items: { 'item-1': { price: 100, is_active: true, deleted_at: null } },
        policies: [
          policyRow({
            branch_id: null,
            role_id: null,
            allow_discount: true,
            max_discount_percent: 50,
            allow_zero_price: true,
          }),
        ],
      });
      const result = await service.resolvePrice({
        ...BASE_INPUT,
        requestedUnitPrice: 0,
      }); // 100% > 50%
      expect(result).toMatchObject({
        kind: 'rejected',
        reasonCode: 'limit_exceeded',
      });
    });

    it('zero price fully approved end-to-end (max_discount_percent=100 permits the 100% discount)', async () => {
      const { service } = makeService({
        items: { 'item-1': { price: 100, is_active: true, deleted_at: null } },
        policies: [
          policyRow({
            branch_id: null,
            role_id: null,
            allow_discount: true,
            max_discount_percent: 100,
            allow_zero_price: true,
          }),
        ],
      });
      const result = await service.resolvePrice({
        ...BASE_INPUT,
        requestedUnitPrice: 0,
      });
      expect(result).toMatchObject({
        kind: 'approved',
        direction: 'discount',
        differencePercent: 100,
      });
    });
  });

  describe('Increase', () => {
    it('allowed within limit -> approved', async () => {
      const { service } = makeService({
        items: { 'item-1': { price: 100, is_active: true, deleted_at: null } },
        policies: [TENANT_PERMISSIVE_POLICY],
      });
      const result = await service.resolvePrice({
        ...BASE_INPUT,
        requestedUnitPrice: 120,
      });
      expect(result).toMatchObject({
        kind: 'approved',
        direction: 'increase',
        differenceAmount: 20,
        differencePercent: 20,
      });
    });

    it('allow_increase not true -> rejected increase_not_allowed', async () => {
      const { service } = makeService({
        items: { 'item-1': { price: 100, is_active: true, deleted_at: null } },
        policies: [
          policyRow({ branch_id: null, role_id: null, allow_increase: false }),
        ],
      });
      const result = await service.resolvePrice({
        ...BASE_INPUT,
        requestedUnitPrice: 120,
      });
      expect(result).toMatchObject({
        kind: 'rejected',
        reasonCode: 'increase_not_allowed',
      });
    });

    it('limit exceeded -> rejected limit_exceeded', async () => {
      const { service } = makeService({
        items: { 'item-1': { price: 100, is_active: true, deleted_at: null } },
        policies: [
          policyRow({
            branch_id: null,
            role_id: null,
            allow_increase: true,
            max_increase_percent: 5,
          }),
        ],
      });
      const result = await service.resolvePrice({
        ...BASE_INPUT,
        requestedUnitPrice: 150,
      });
      expect(result).toMatchObject({
        kind: 'rejected',
        reasonCode: 'limit_exceeded',
      });
    });
  });

  describe('Policy resolution / inheritance', () => {
    it('no tenant policy at all -> rejected no_effective_policy', async () => {
      const { service } = makeService({
        items: { 'item-1': { price: 100, is_active: true, deleted_at: null } },
        policies: [],
      });
      const result = await service.resolvePrice({
        ...BASE_INPUT,
        requestedUnitPrice: 80,
      });
      expect(result).toMatchObject({
        kind: 'rejected',
        reasonCode: 'no_effective_policy',
      });
    });

    it('branch override wins over tenant default', async () => {
      const { service } = makeService({
        items: { 'item-1': { price: 100, is_active: true, deleted_at: null } },
        policies: [
          policyRow({ branch_id: null, role_id: null, allow_discount: false }),
          policyRow({
            branch_id: 'b1',
            role_id: null,
            allow_discount: true,
            max_discount_percent: 50,
          }),
        ],
      });
      const result = await service.resolvePrice({
        ...BASE_INPUT,
        requestedUnitPrice: 80,
      });
      expect(result).toMatchObject({ kind: 'approved' });
    });

    it('role override wins over branch and tenant', async () => {
      const { service } = makeService({
        items: { 'item-1': { price: 100, is_active: true, deleted_at: null } },
        policies: [
          policyRow({
            branch_id: null,
            role_id: null,
            allow_discount: true,
            max_discount_percent: 5,
          }),
          policyRow({
            branch_id: 'b1',
            role_id: null,
            allow_discount: true,
            max_discount_percent: 5,
          }),
          policyRow({
            branch_id: 'b1',
            role_id: OWNER_ROLE.roleId,
            allow_discount: true,
            max_discount_percent: 90,
          }),
        ],
      });
      const result = await service.resolvePrice({
        ...BASE_INPUT,
        requestedUnitPrice: 20,
      }); // 80% discount
      expect(result).toMatchObject({ kind: 'approved' });
    });

    it('field left unset at every level (NULL after inheritance) -> denied', async () => {
      const { service } = makeService({
        items: { 'item-1': { price: 100, is_active: true, deleted_at: null } },
        policies: [
          policyRow({ branch_id: null, role_id: null, allow_discount: true }), // max_discount_percent unset
        ],
      });
      const result = await service.resolvePrice({
        ...BASE_INPUT,
        requestedUnitPrice: 80,
      });
      expect(result).toMatchObject({
        kind: 'rejected',
        reasonCode: 'limit_exceeded',
      });
    });

    it('no role-specific row -> falls back to branch/tenant', async () => {
      const { service } = makeService({
        items: { 'item-1': { price: 100, is_active: true, deleted_at: null } },
        policies: [
          policyRow({
            branch_id: null,
            role_id: null,
            allow_discount: true,
            max_discount_percent: 50,
          }),
        ],
      });
      const result = await service.resolvePrice({
        ...BASE_INPUT,
        requestedUnitPrice: 80,
      });
      expect(result).toMatchObject({ kind: 'approved' });
    });
  });

  describe('Role', () => {
    it('unresolved role tie / no effective role -> rejected no_effective_role, skips permission+policy', async () => {
      const { service, permissions } = makeService({
        items: { 'item-1': { price: 100, is_active: true, deleted_at: null } },
        policies: [TENANT_PERMISSIVE_POLICY],
        effectiveRole: null,
      });
      const result = await service.resolvePrice({
        ...BASE_INPUT,
        requestedUnitPrice: 80,
      });
      expect(result).toMatchObject({
        kind: 'rejected',
        reasonCode: 'no_effective_role',
      });
      expect(permissions.hasPermissionForUser).not.toHaveBeenCalled();
    });
  });

  describe('Permission', () => {
    it('granted -> proceeds to policy evaluation', async () => {
      const { service } = makeService({
        items: { 'item-1': { price: 100, is_active: true, deleted_at: null } },
        policies: [TENANT_PERMISSIVE_POLICY],
        permissionGranted: true,
      });
      const result = await service.resolvePrice({
        ...BASE_INPUT,
        requestedUnitPrice: 80,
      });
      expect(result).toMatchObject({ kind: 'approved' });
    });

    it('denied -> rejected permission_denied, skips policy lookup', async () => {
      const { service } = makeService({
        items: { 'item-1': { price: 100, is_active: true, deleted_at: null } },
        policies: [TENANT_PERMISSIVE_POLICY],
        permissionGranted: false,
      });
      const result = await service.resolvePrice({
        ...BASE_INPUT,
        requestedUnitPrice: 80,
      });
      expect(result).toMatchObject({
        kind: 'rejected',
        reasonCode: 'permission_denied',
      });
    });
  });

  describe('Prices', () => {
    it('no variant -> official = items.price', async () => {
      const { service } = makeService({
        items: { 'item-1': { price: 100, is_active: true, deleted_at: null } },
      });
      const result = await service.resolvePrice({
        ...BASE_INPUT,
        requestedUnitPrice: 100,
      });
      expect(result).toEqual({ kind: 'no_override', officialUnitPrice: 100 });
    });

    it('positive variant adjustment -> official = price + adjustment', async () => {
      const { service } = makeService({
        items: { 'item-1': { price: 100, is_active: true, deleted_at: null } },
        variants: {
          v1: { item_id: 'item-1', price_adjustment: 15, is_active: true },
        },
      });
      const result = await service.resolvePrice({
        ...BASE_INPUT,
        variantId: 'v1',
        requestedUnitPrice: 115,
      });
      expect(result).toEqual({ kind: 'no_override', officialUnitPrice: 115 });
    });

    it('negative variant adjustment -> official = price - adjustment', async () => {
      const { service } = makeService({
        items: { 'item-1': { price: 100, is_active: true, deleted_at: null } },
        variants: {
          v1: { item_id: 'item-1', price_adjustment: -20, is_active: true },
        },
      });
      const result = await service.resolvePrice({
        ...BASE_INPUT,
        variantId: 'v1',
        requestedUnitPrice: 80,
      });
      expect(result).toEqual({ kind: 'no_override', officialUnitPrice: 80 });
    });

    it('deleted item -> rejected item_or_variant_not_found', async () => {
      const { service } = makeService({
        items: {
          'item-1': {
            price: 100,
            is_active: true,
            deleted_at: '2026-01-01T00:00:00Z',
          },
        },
      });
      const result = await service.resolvePrice({
        ...BASE_INPUT,
        requestedUnitPrice: 100,
      });
      expect(result).toMatchObject({
        kind: 'rejected',
        reasonCode: 'item_or_variant_not_found',
      });
    });

    it('inactive item -> rejected item_or_variant_not_found', async () => {
      const { service } = makeService({
        items: { 'item-1': { price: 100, is_active: false, deleted_at: null } },
      });
      const result = await service.resolvePrice({
        ...BASE_INPUT,
        requestedUnitPrice: 100,
      });
      expect(result).toMatchObject({
        kind: 'rejected',
        reasonCode: 'item_or_variant_not_found',
      });
    });

    it('invalid/inactive variant -> rejected item_or_variant_not_found', async () => {
      const { service } = makeService({
        items: { 'item-1': { price: 100, is_active: true, deleted_at: null } },
        variants: {
          v1: { item_id: 'item-1', price_adjustment: 10, is_active: false },
        },
      });
      const result = await service.resolvePrice({
        ...BASE_INPUT,
        variantId: 'v1',
        requestedUnitPrice: 100,
      });
      expect(result).toMatchObject({
        kind: 'rejected',
        reasonCode: 'item_or_variant_not_found',
      });
    });
  });

  describe('Combine with discount', () => {
    it('invoice-level discount present, allow_combine_with_discount=true -> approved', async () => {
      const { service } = makeService({
        items: { 'item-1': { price: 100, is_active: true, deleted_at: null } },
        policies: [TENANT_PERMISSIVE_POLICY],
      });
      const result = await service.resolvePrice({
        ...BASE_INPUT,
        requestedUnitPrice: 80,
        hasInvoiceLevelDiscount: true,
      });
      expect(result).toMatchObject({ kind: 'approved' });
    });

    it('invoice-level discount present, allow_combine_with_discount=false -> rejected', async () => {
      const { service } = makeService({
        items: { 'item-1': { price: 100, is_active: true, deleted_at: null } },
        policies: [
          policyRow({
            branch_id: null,
            role_id: null,
            allow_discount: true,
            max_discount_percent: 50,
            allow_combine_with_discount: false,
          }),
        ],
      });
      const result = await service.resolvePrice({
        ...BASE_INPUT,
        requestedUnitPrice: 80,
        hasInvoiceLevelDiscount: true,
      });
      expect(result).toMatchObject({
        kind: 'rejected',
        reasonCode: 'combine_with_discount_not_allowed',
      });
    });
  });
});
