import { CustomersService } from './customers.service';
import { CustomersRepository } from './customers.repository';
import { CustomerFieldDefinitionsRepository } from './customer-field-definitions.repository';
import { TenantsService } from '../tenants/tenants.service';
import { TenantContext } from '../../core/tenant/tenant-context';
import { JwtPayload } from '../../shared/types/jwt-payload.type';

// Customer Domain Phase 2 (Owner-approved) — targeted tests for
// created_branch_id capture at customer creation. Following the same
// "stub the external dependencies, exercise the real service" convention
// already established for Reports/Audit branch-context tests. created_
// branch_id is informational provenance only (not authorization/
// visibility, which is Phase 3/4) — these tests only verify the capture
// rule itself.

const TENANT_ID = 'tenant-a';
const BRANCH_A = 'branch-a';
const BRANCH_B = 'branch-b';

function tenantContext(): TenantContext {
  return new TenantContext(TENANT_ID, null);
}

function centralUser(): JwtPayload {
  return {
    sub: 'user-central',
    email: 'central@test.com',
    role: 'owner',
    tenant_id: TENANT_ID,
    session_id: 's1',
    business_type: null,
    activity: null,
    branch_id: null,
  };
}

function cashierUser(branchId: string): JwtPayload {
  return {
    sub: 'user-cashier',
    email: 'cashier@test.com',
    role: 'cashier',
    tenant_id: TENANT_ID,
    session_id: 's2',
    business_type: null,
    activity: null,
    branch_id: branchId,
  };
}

function buildService(
  opts: {
    scope?: 'shared' | 'branch';
    relatedCustomerIds?: string[];
    hasRelationship?: boolean;
    existingCustomer?: Record<string, unknown> | null;
    findAllResult?: Record<string, unknown>[];
  } = {},
): {
  service: CustomersService;
  createCalls: Record<string, unknown>[];
  upsertRelationshipCalls: unknown[][];
  findAllCalls: unknown[][];
} {
  const createCalls: Record<string, unknown>[] = [];
  const upsertRelationshipCalls: unknown[][] = [];
  const findAllCalls: unknown[][] = [];

  const repo = {
    findByPhone: jest.fn().mockResolvedValue(null),
    countAll: jest.fn().mockResolvedValue(0),
    create: jest.fn(
      (_tenant: TenantContext, payload: Record<string, unknown>) => {
        createCalls.push(payload);
        return Promise.resolve({ id: 'new-customer-id', ...payload });
      },
    ),
    upsertRelationship: jest.fn((...args: unknown[]) => {
      upsertRelationshipCalls.push(args);
      return Promise.resolve();
    }),
    getCustomerIdentityScope: jest
      .fn()
      .mockResolvedValue(opts.scope ?? 'shared'),
    findRelatedCustomerIds: jest
      .fn()
      .mockResolvedValue(opts.relatedCustomerIds ?? []),
    hasRelationship: jest.fn().mockResolvedValue(opts.hasRelationship ?? false),
    findById: jest
      .fn()
      .mockResolvedValue(
        opts.existingCustomer === undefined
          ? { id: 'existing-customer-id', full_name: 'Test Customer' }
          : opts.existingCustomer,
      ),
    findAll: jest.fn((...args: unknown[]) => {
      findAllCalls.push(args);
      return Promise.resolve(opts.findAllResult ?? []);
    }),
  } as unknown as CustomersRepository;

  const fieldDefinitionsRepo = {
    findAll: jest.fn().mockResolvedValue([]),
  } as unknown as CustomerFieldDefinitionsRepository;

  const tenantsService = {
    getPosConfig: jest.fn().mockResolvedValue({
      tax_rate: 0,
      customer_capture_enabled: true,
      name_field_enabled: false,
      loyalty_enabled: true,
    }),
  } as unknown as TenantsService;

  const service = new CustomersService(
    repo,
    fieldDefinitionsRepo,
    tenantsService,
  );
  return { service, createCalls, upsertRelationshipCalls, findAllCalls };
}

describe('CustomersService.create — created_branch_id capture (Phase 2)', () => {
  it('cashier (restricted) creation automatically captures the actor own branch, ignoring any dto override', async () => {
    const { service, createCalls } = buildService();

    await service.create(tenantContext(), cashierUser(BRANCH_A), {
      created_branch_id: BRANCH_B, // must be ignored — cashier's own branch always wins
    });

    expect(createCalls[0].created_branch_id).toBe(BRANCH_A);
  });

  it('Central creation with explicit created_branch_id uses the supplied branch', async () => {
    const { service, createCalls } = buildService();

    await service.create(tenantContext(), centralUser(), {
      created_branch_id: BRANCH_A,
    });

    expect(createCalls[0].created_branch_id).toBe(BRANCH_A);
  });

  it('Central creation with no branch context leaves created_branch_id NULL (not an error)', async () => {
    const { service, createCalls } = buildService();

    await service.create(tenantContext(), centralUser(), {});

    expect(createCalls[0].created_branch_id).toBeNull();
  });

  it('cashier creation with no dto branch still captures the actor own branch', async () => {
    const { service, createCalls } = buildService();

    await service.create(tenantContext(), cashierUser(BRANCH_B), {});

    expect(createCalls[0].created_branch_id).toBe(BRANCH_B);
  });
});

describe('CustomersService.create — relationship seeding (Phase 3)', () => {
  it('seeds a relationship (source=created) when a branch context is known', async () => {
    const { service, upsertRelationshipCalls } = buildService();

    await service.create(tenantContext(), cashierUser(BRANCH_A), {});

    expect(upsertRelationshipCalls).toHaveLength(1);
    expect(upsertRelationshipCalls[0][1]).toBe('new-customer-id');
    expect(upsertRelationshipCalls[0][2]).toBe(BRANCH_A);
    expect(upsertRelationshipCalls[0][3]).toBe('created');
  });

  it('does not seed a relationship when no branch context exists (Central, no explicit branch)', async () => {
    const { service, upsertRelationshipCalls } = buildService();

    await service.create(tenantContext(), centralUser(), {});

    expect(upsertRelationshipCalls).toHaveLength(0);
  });
});

describe('CustomersService.recordBranchActivity (Phase 3)', () => {
  it('delegates to repo.upsertRelationship with source=transaction', async () => {
    const { service, upsertRelationshipCalls } = buildService();

    await service.recordBranchActivity(tenantContext(), 'customer-1', BRANCH_A);

    expect(upsertRelationshipCalls).toHaveLength(1);
    expect(upsertRelationshipCalls[0]).toEqual([
      tenantContext(),
      'customer-1',
      BRANCH_A,
      'transaction',
    ]);
  });
});

// Customer Domain Phase 4 (Owner-approved) — branch-aware list/read access,
// via customer_branch_relationships, never customers.branch_id (no such
// column exists). Central always unrestricted; restricted actors are only
// restricted under an explicit 'branch' tenant scope.
describe('CustomersService.findAll — visibility (Phase 4)', () => {
  it('1. Central + SHARED → unrestricted (no scope lookup even needed)', async () => {
    const { service, findAllCalls } = buildService({ scope: 'shared' });

    await service.findAll(tenantContext(), centralUser(), {});

    // restrictToCustomerIds (6th positional arg) must be undefined
    expect(findAllCalls[0][5]).toBeUndefined();
  });

  it('2. Restricted + SHARED → unrestricted, all tenant customers visible', async () => {
    const { service, findAllCalls } = buildService({ scope: 'shared' });

    await service.findAll(tenantContext(), cashierUser(BRANCH_A), {});

    expect(findAllCalls[0][5]).toBeUndefined();
  });

  it('3. Restricted + BRANCH → restricted to related customer ids', async () => {
    const { service, findAllCalls } = buildService({
      scope: 'branch',
      relatedCustomerIds: ['cust-1', 'cust-2'],
    });

    await service.findAll(tenantContext(), cashierUser(BRANCH_A), {});

    expect(findAllCalls[0][5]).toEqual(['cust-1', 'cust-2']);
  });

  it('4. BRANCH restricted user sees only related customers (short-circuits to empty when none related)', async () => {
    const { service, findAllCalls } = buildService({
      scope: 'branch',
      relatedCustomerIds: [],
    });

    const result = await service.findAll(
      tenantContext(),
      cashierUser(BRANCH_A),
      {},
    );

    expect(result).toEqual({ data: [], total: 0 });
    // repo.findAll must never even be called once we know there's nothing to return
    expect(findAllCalls).toHaveLength(0);
  });

  it('5. Central + BRANCH tenant → still unrestricted (Central bypasses visibility entirely)', async () => {
    const { service, findAllCalls } = buildService({ scope: 'branch' });

    await service.findAll(tenantContext(), centralUser(), {});

    expect(findAllCalls[0][5]).toBeUndefined();
  });
});

// Batch 1 Remediation 2 (Owner-approved) — the invariant this remediation
// exists to prove: a failure to determine Customer Scope must never widen
// visibility. getCustomerIdentityScope() itself already fails toward
// 'branch' on a malformed read (see customers.repository.spec.ts) and
// still throws on a genuine infrastructure error — this proves the SERVICE
// layer built on top of it never converts either outcome into an
// unrestricted result for a restricted actor.
describe('CustomersService.findAll — scope-failure cannot widen visibility (Batch 1 Remediation 2)', () => {
  it('7a. restricted findAll() under a resolved-to-branch fallback stays restricted, never exposes the full tenant roster', async () => {
    // Simulates the repository's own fail-closed fallback having already
    // resolved a malformed read to 'branch' — the service must treat that
    // exactly like a genuine BRANCH tenant, not special-case it toward
    // unrestricted.
    const { service, findAllCalls } = buildService({
      scope: 'branch',
      relatedCustomerIds: ['cust-1'],
    });

    await service.findAll(tenantContext(), cashierUser(BRANCH_A), {});

    expect(findAllCalls[0][5]).toEqual(['cust-1']);
    expect(findAllCalls[0][5]).not.toBeUndefined();
  });

  it('7b. restricted findAll() propagates a genuine scope-lookup failure rather than silently returning unrestricted data', async () => {
    const { service, findAllCalls } = buildService({ scope: 'branch' });
    const repo = (service as unknown as { repo: CustomersRepository }).repo;
    (repo.getCustomerIdentityScope as jest.Mock).mockRejectedValue(
      new Error('simulated infrastructure failure'),
    );

    await expect(
      service.findAll(tenantContext(), cashierUser(BRANCH_A), {}),
    ).rejects.toThrow('simulated infrastructure failure');

    // The unrestricted repo.findAll() must never have been reached at all.
    expect(findAllCalls).toHaveLength(0);
  });
});

describe('CustomersService.findById — visibility (Phase 4)', () => {
  it('6. Central can read any customer regardless of scope', async () => {
    const { service } = buildService({
      scope: 'branch',
      hasRelationship: false, // even with no relationship, Central bypasses
      existingCustomer: { id: 'cust-1', full_name: 'X' },
    });

    await expect(
      service.findById(tenantContext(), centralUser(), 'cust-1'),
    ).resolves.toEqual({ id: 'cust-1', full_name: 'X' });
  });

  it('7. Restricted + BRANCH, relationship exists → allowed', async () => {
    const { service } = buildService({
      scope: 'branch',
      hasRelationship: true,
      existingCustomer: { id: 'cust-1', full_name: 'X' },
    });

    await expect(
      service.findById(tenantContext(), cashierUser(BRANCH_A), 'cust-1'),
    ).resolves.toEqual({ id: 'cust-1', full_name: 'X' });
  });

  it('5(b). Unrelated branch customer is not visible — restricted + BRANCH, no relationship → NotFoundException (not 403, matches BranchAuthorizationService detail-read convention)', async () => {
    const { service } = buildService({
      scope: 'branch',
      hasRelationship: false,
      existingCustomer: { id: 'cust-1', full_name: 'X' },
    });

    await expect(
      service.findById(tenantContext(), cashierUser(BRANCH_A), 'cust-1'),
    ).rejects.toThrow('Customer not found');
  });

  it('Restricted + SHARED → allowed regardless of relationship state', async () => {
    const { service } = buildService({
      scope: 'shared',
      hasRelationship: false,
      existingCustomer: { id: 'cust-1', full_name: 'X' },
    });

    await expect(
      service.findById(tenantContext(), cashierUser(BRANCH_A), 'cust-1'),
    ).resolves.toEqual({ id: 'cust-1', full_name: 'X' });
  });
});

describe('CustomersService — cross-tenant isolation (Phase 4)', () => {
  it('13. relationship lookups are scoped to the caller tenant_id, not global', async () => {
    const TENANT_B = 'tenant-b';
    const { service } = buildService({
      scope: 'branch',
      relatedCustomerIds: [],
    });
    const tenantBContext = new TenantContext(TENANT_B, null);

    await service.findAll(
      tenantBContext,
      { ...cashierUser(BRANCH_A), tenant_id: TENANT_B },
      {},
    );

    // findRelatedCustomerIds must have been called with tenant B's id, not
    // hardcoded/leaked from another tenant's context.
    interface ServiceWithRepo {
      repo: {
        findRelatedCustomerIds: jest.Mock<Promise<string[]>, [string, string]>;
      };
    }
    const { repo } = service as unknown as ServiceWithRepo;
    expect(repo.findRelatedCustomerIds.mock.calls[0][0]).toBe(TENANT_B);
  });
});

describe('CustomersService.findByIdUnrestricted (Phase 4 — POS/checkout escape hatch)', () => {
  it('10. never applies visibility restriction — a customer can be attached to an order at any branch', async () => {
    const { service } = buildService({
      scope: 'branch',
      hasRelationship: false, // would be rejected by findById(), must NOT be rejected here
      existingCustomer: { id: 'cust-1', full_name: 'X' },
    });

    await expect(
      service.findByIdUnrestricted(tenantContext(), 'cust-1'),
    ).resolves.toEqual({ id: 'cust-1', full_name: 'X' });
  });
});
