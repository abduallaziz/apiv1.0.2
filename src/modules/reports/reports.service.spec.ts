import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { ReportsService } from './reports.service';
import { BranchAuthorizationService } from '../../core/security/branch-authorization.service';
import { BranchValidatorService } from '../../core/security/branch-validator.service';
import { TenantContext } from '../../core/tenant/tenant-context';
import { JwtPayload } from '../../shared/types/jwt-payload.type';

// Branch System Step 5, Item 1 (Owner-approved) — integration test for
// GET /reports/revenue's branch-authorization wiring specifically (the
// report's own math/aggregation logic is pre-existing and unchanged, not
// under test here). The Supabase client is a minimal fake chainable query
// builder so these tests exercise real ReportsService + real
// BranchAuthorizationService.resolveBranchScope() logic together, without
// needing a live database — the same "stub the one true external
// dependency" approach BranchAuthorizationService's own spec already uses
// for BranchValidatorService.

const TENANT_A = 'tenant-a';
const BRANCH_A1 = 'branch-a1';
const BRANCH_A2 = 'branch-a2';

function tenantContext(): TenantContext {
  return new TenantContext(TENANT_A, null);
}

function centralUser(): JwtPayload {
  return {
    sub: 'user-central',
    email: 'central@test.com',
    role: 'owner',
    tenant_id: TENANT_A,
    session_id: 's1',
    business_type: null,
    activity: null,
    branch_id: null,
  };
}

function restrictedUser(branchId: string): JwtPayload {
  return {
    sub: 'user-restricted',
    email: 'restricted@test.com',
    role: 'cashier',
    tenant_id: TENANT_A,
    session_id: 's2',
    business_type: null,
    activity: null,
    branch_id: branchId,
  };
}

interface FakeChain {
  from: jest.Mock;
  select: jest.Mock;
  eq: jest.Mock;
  gte: jest.Mock;
  lte: jest.Mock;
  is: jest.Mock;
  not: jest.Mock;
  in: jest.Mock;
  order: jest.Mock;
  limit: jest.Mock;
  single: jest.Mock;
  maybeSingle: jest.Mock;
  then: (resolve: (v: { data: unknown[]; error: null }) => void) => void;
}

// Records every .eq(...) call made on the orders/shifts query, then
// resolves to an empty result set — sufficient to prove *which* branch
// filter was actually applied without needing real report-math fixtures.
function fakeSupabase(): {
  supabase: SupabaseClient;
  eqCalls: [string, unknown][];
  fromMock: jest.Mock;
} {
  const eqCalls: [string, unknown][] = [];
  const fromMock = jest.fn(() => chain);
  const chain: FakeChain = {
    from: fromMock,
    select: jest.fn(() => chain),
    eq: jest.fn((col: string, val: unknown) => {
      eqCalls.push([col, val]);
      return chain;
    }),
    gte: jest.fn(() => chain),
    lte: jest.fn(() => chain),
    is: jest.fn(() => chain),
    not: jest.fn(() => chain),
    in: jest.fn(() => chain),
    order: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    single: jest.fn(() => Promise.resolve({ data: null, error: null })),
    maybeSingle: jest.fn(() =>
      Promise.resolve({ data: { timezone: 'UTC' }, error: null }),
    ),
    then: (resolve) => resolve({ data: [], error: null }),
  };
  return { supabase: chain as unknown as SupabaseClient, eqCalls, fromMock };
}

// Same fake chain as fakeSupabase(), but resolves with real rows instead of
// an empty set — used by the expense totals/counts/category-join cases,
// which need to assert on actual aggregation output, not just which
// filters were applied.
function fakeSupabaseWithRows(rows: unknown[]): {
  supabase: SupabaseClient;
  eqCalls: [string, unknown][];
  fromMock: jest.Mock;
} {
  const eqCalls: [string, unknown][] = [];
  const fromMock = jest.fn(() => chain);
  const chain: FakeChain = {
    from: fromMock,
    select: jest.fn(() => chain),
    eq: jest.fn((col: string, val: unknown) => {
      eqCalls.push([col, val]);
      return chain;
    }),
    gte: jest.fn(() => chain),
    lte: jest.fn(() => chain),
    is: jest.fn(() => chain),
    not: jest.fn(() => chain),
    in: jest.fn(() => chain),
    order: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    single: jest.fn(() => Promise.resolve({ data: null, error: null })),
    maybeSingle: jest.fn(() =>
      Promise.resolve({ data: { timezone: 'UTC' }, error: null }),
    ),
    then: (resolve) => resolve({ data: rows, error: null }),
  };
  return { supabase: chain as unknown as SupabaseClient, eqCalls, fromMock };
}

function validator(impl: () => Promise<void>): BranchValidatorService {
  return { validate: jest.fn(impl) } as unknown as BranchValidatorService;
}

const alwaysValid = () => Promise.resolve();
const alwaysInvalid = () =>
  Promise.reject(new Error('Branch not found or does not belong to tenant'));

describe('ReportsService.getRevenueReport — branch authorization', () => {
  it('Central + omitted branch → tenant-wide, no branch_id filter applied', async () => {
    const { supabase, eqCalls } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    await service.getRevenueReport(tenantContext(), centralUser(), {});

    expect(eqCalls.find(([col]) => col === 'branch_id')).toBeUndefined();
  });

  it('Central + explicit branch → scoped to that branch', async () => {
    const { supabase, eqCalls } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    await service.getRevenueReport(tenantContext(), centralUser(), {
      branch_id: BRANCH_A1,
    });

    expect(eqCalls).toContainEqual(['branch_id', BRANCH_A1]);
  });

  it('Restricted + omitted branch → forced to own branch', async () => {
    const { supabase, eqCalls } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    await service.getRevenueReport(
      tenantContext(),
      restrictedUser(BRANCH_A1),
      {},
    );

    expect(eqCalls).toContainEqual(['branch_id', BRANCH_A1]);
  });

  it('Restricted + own branch (explicit) → allowed, scoped to own branch', async () => {
    const { supabase, eqCalls } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    await service.getRevenueReport(tenantContext(), restrictedUser(BRANCH_A1), {
      branch_id: BRANCH_A1,
    });

    expect(eqCalls).toContainEqual(['branch_id', BRANCH_A1]);
  });

  it('Restricted + other branch (explicit) → rejected, no query executed', async () => {
    const { supabase, fromMock } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    await expect(
      service.getRevenueReport(tenantContext(), restrictedUser(BRANCH_A1), {
        branch_id: BRANCH_A2,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('Restricted + manipulated query branch_id → same rejection as explicit other-branch', async () => {
    const { supabase } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    await expect(
      service.getRevenueReport(tenantContext(), restrictedUser(BRANCH_A1), {
        branch_id: 'someone-elses-branch',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('Cross-tenant branch → rejected', async () => {
    const { supabase } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysInvalid));
    const service = new ReportsService(supabase, branchAuth);

    await expect(
      service.getRevenueReport(tenantContext(), centralUser(), {
        branch_id: 'branch-of-other-tenant',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('date-range combination (custom period) composes correctly with branch scoping', async () => {
    const { supabase, eqCalls } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    const result = await service.getRevenueReport(
      tenantContext(),
      restrictedUser(BRANCH_A1),
      {
        period: 'custom' as never,
        from: '2026-01-01',
        to: '2026-01-31',
      },
    );

    expect(eqCalls).toContainEqual(['branch_id', BRANCH_A1]);
    expect(result.period.from).toBe('2026-01-01T00:00:00.000Z');
    expect(result.period.to).toBe('2026-01-31T23:59:59.999Z');
  });

  it('aggregate correctness: empty result set still returns zeroed summary, not an error', async () => {
    const { supabase } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    const result = await service.getRevenueReport(
      tenantContext(),
      restrictedUser(BRANCH_A1),
      {},
    );

    expect(result.summary.total_revenue).toBe(0);
    expect(result.summary.total_orders).toBe(0);
    expect(result.summary.avg_order_value).toBe(0);
  });
});

// Reports Authorization Item 2 (Owner-approved) — GET /reports/shifts,
// same pattern as the /reports/revenue suite above: only the branch-
// authorization wiring is under test, shift math is pre-existing/unchanged.
describe('ReportsService.getShiftsReport — branch authorization', () => {
  it('Central + omitted branch → tenant-wide, no branch_id filter applied', async () => {
    const { supabase, eqCalls } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    await service.getShiftsReport(tenantContext(), centralUser(), {});

    expect(eqCalls.find(([col]) => col === 'branch_id')).toBeUndefined();
  });

  it('Central + explicit own-tenant branch → scoped to that branch', async () => {
    const { supabase, eqCalls } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    await service.getShiftsReport(tenantContext(), centralUser(), {
      branch_id: BRANCH_A1,
    });

    expect(eqCalls).toContainEqual(['branch_id', BRANCH_A1]);
  });

  it('Restricted + omitted branch → automatically scoped to own branch', async () => {
    const { supabase, eqCalls } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    await service.getShiftsReport(
      tenantContext(),
      restrictedUser(BRANCH_A1),
      {},
    );

    expect(eqCalls).toContainEqual(['branch_id', BRANCH_A1]);
  });

  it('Restricted + explicit own branch → allowed, same result as omitted', async () => {
    const { supabase, eqCalls } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    await service.getShiftsReport(tenantContext(), restrictedUser(BRANCH_A1), {
      branch_id: BRANCH_A1,
    });

    expect(eqCalls).toContainEqual(['branch_id', BRANCH_A1]);
  });

  it('Restricted + explicit other branch → 403, no query executed', async () => {
    const { supabase, fromMock } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    await expect(
      service.getShiftsReport(tenantContext(), restrictedUser(BRANCH_A1), {
        branch_id: BRANCH_A2,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('Restricted + manipulated query branch_id → 403, no query executed', async () => {
    const { supabase, fromMock } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    await expect(
      service.getShiftsReport(tenantContext(), restrictedUser(BRANCH_A1), {
        branch_id: 'someone-elses-branch',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('Cross-tenant branch → rejected', async () => {
    const { supabase } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysInvalid));
    const service = new ReportsService(supabase, branchAuth);

    await expect(
      service.getShiftsReport(tenantContext(), centralUser(), {
        branch_id: 'branch-of-other-tenant',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('date-range combination (custom period) composes correctly with branch scoping', async () => {
    const { supabase, eqCalls } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    const result = await service.getShiftsReport(
      tenantContext(),
      restrictedUser(BRANCH_A1),
      {
        period: 'custom' as never,
        from: '2026-01-01',
        to: '2026-01-31',
      },
    );

    expect(eqCalls).toContainEqual(['branch_id', BRANCH_A1]);
    expect(result.period.from).toBe('2026-01-01T00:00:00.000Z');
    expect(result.period.to).toBe('2026-01-31T23:59:59.999Z');
  });

  it('empty/no-shift branch → valid zero/empty response, not an error', async () => {
    const { supabase } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    const result = await service.getShiftsReport(
      tenantContext(),
      restrictedUser(BRANCH_A1),
      {},
    );

    expect(result.summary.total_shifts).toBe(0);
    expect(result.summary.closed_shifts).toBe(0);
    expect(result.summary.open_shifts).toBe(0);
    expect(result.summary.total_discrepancy).toBe(0);
    expect(result.summary.avg_discrepancy).toBe(0);
    expect(result.shifts).toEqual([]);
  });
});

// Reports Authorization Item 3 (Owner-approved) — GET /reports/expenses,
// same pattern as revenue/shifts above: only the branch-authorization
// wiring is under test, expense math/grouping is pre-existing/unchanged.
// getExpensesReport() issues exactly one query against Legacy `expenses`
// with an embedded `category:expense_categories(id, name)` relation —
// expense_categories has no branch_id (tenant-wide catalog, FK lookup
// only), so the join cannot reintroduce another branch's rows; this is
// exercised directly in the "related data" case below by returning a
// populated fake row and confirming its category still resolves under
// branch scoping instead of being dropped/altered.
describe('ReportsService.getExpensesReport — branch authorization', () => {
  it('Central + omitted branch → tenant-wide, no branch_id filter applied', async () => {
    const { supabase, eqCalls } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    await service.getExpensesReport(tenantContext(), centralUser(), {});

    expect(eqCalls.find(([col]) => col === 'branch_id')).toBeUndefined();
  });

  it('Central + explicit same-tenant branch → branch-scoped result', async () => {
    const { supabase, eqCalls } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    await service.getExpensesReport(tenantContext(), centralUser(), {
      branch_id: BRANCH_A1,
    });

    expect(eqCalls).toContainEqual(['branch_id', BRANCH_A1]);
  });

  it('Central + cross-tenant branch → rejected', async () => {
    const { supabase } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysInvalid));
    const service = new ReportsService(supabase, branchAuth);

    await expect(
      service.getExpensesReport(tenantContext(), centralUser(), {
        branch_id: 'branch-of-other-tenant',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('Restricted + omitted branch → automatically scoped to own branch', async () => {
    const { supabase, eqCalls } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    await service.getExpensesReport(
      tenantContext(),
      restrictedUser(BRANCH_A1),
      {},
    );

    expect(eqCalls).toContainEqual(['branch_id', BRANCH_A1]);
  });

  it('Restricted + explicit own branch → allowed', async () => {
    const { supabase, eqCalls } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    await service.getExpensesReport(
      tenantContext(),
      restrictedUser(BRANCH_A1),
      {
        branch_id: BRANCH_A1,
      },
    );

    expect(eqCalls).toContainEqual(['branch_id', BRANCH_A1]);
  });

  it('Restricted + explicit other branch → 403, no query executed', async () => {
    const { supabase, fromMock } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    await expect(
      service.getExpensesReport(tenantContext(), restrictedUser(BRANCH_A1), {
        branch_id: BRANCH_A2,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('Restricted + manipulated query branch_id → 403, no query executed', async () => {
    const { supabase, fromMock } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    await expect(
      service.getExpensesReport(tenantContext(), restrictedUser(BRANCH_A1), {
        branch_id: 'someone-elses-branch',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('date-range combination (custom period) composes correctly with branch scoping', async () => {
    const { supabase, eqCalls } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    const result = await service.getExpensesReport(
      tenantContext(),
      restrictedUser(BRANCH_A1),
      {
        period: 'custom' as never,
        from: '2026-01-01',
        to: '2026-01-31',
      },
    );

    expect(eqCalls).toContainEqual(['branch_id', BRANCH_A1]);
    expect(result.period.from).toBe('2026-01-01T00:00:00.000Z');
    expect(result.period.to).toBe('2026-01-31T23:59:59.999Z');
  });

  it('expense totals: sums only the effective branch', async () => {
    const { supabase } = fakeSupabaseWithRows([
      {
        id: 'e1',
        amount: 100,
        approval_status: 'approved',
        title: null,
        description: null,
        expense_date: '2026-01-05',
        created_at: '2026-01-05T00:00:00.000Z',
        branch_id: BRANCH_A1,
        created_by: 'u1',
        resolved_by: 'u2',
        resolved_at: null,
        category: { id: 'cat-1', name: 'Utilities' },
      },
      {
        id: 'e2',
        amount: 50,
        approval_status: 'approved',
        title: null,
        description: null,
        expense_date: '2026-01-05',
        created_at: '2026-01-06T00:00:00.000Z',
        branch_id: BRANCH_A1,
        created_by: 'u1',
        resolved_by: 'u2',
        resolved_at: null,
        category: { id: 'cat-1', name: 'Utilities' },
      },
    ]);
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    const result = await service.getExpensesReport(
      tenantContext(),
      restrictedUser(BRANCH_A1),
      {},
    );

    expect(result.summary.total_approved_amount).toBe(150);
  });

  it('expense counts: counts only the effective branch', async () => {
    const { supabase } = fakeSupabaseWithRows([
      {
        id: 'e1',
        amount: 100,
        approval_status: 'approved',
        title: null,
        description: null,
        expense_date: '2026-01-05',
        created_at: '2026-01-05T00:00:00.000Z',
        branch_id: BRANCH_A1,
        created_by: 'u1',
        resolved_by: 'u2',
        resolved_at: null,
        category: { id: 'cat-1', name: 'Utilities' },
      },
      {
        id: 'e2',
        amount: 50,
        approval_status: 'pending_action',
        title: null,
        description: null,
        expense_date: '2026-01-05',
        created_at: '2026-01-06T00:00:00.000Z',
        branch_id: BRANCH_A1,
        created_by: 'u1',
        resolved_by: null,
        resolved_at: null,
        category: { id: 'cat-1', name: 'Utilities' },
      },
    ]);
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    const result = await service.getExpensesReport(
      tenantContext(),
      restrictedUser(BRANCH_A1),
      {},
    );

    expect(result.summary.total_requests).toBe(2);
    expect(result.summary.approved_count).toBe(1);
    expect(result.summary.pending_count).toBe(1);
  });

  it('empty branch/date range → valid zero/empty response, not an error', async () => {
    const { supabase } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    const result = await service.getExpensesReport(
      tenantContext(),
      restrictedUser(BRANCH_A1),
      {},
    );

    expect(result.summary.total_requests).toBe(0);
    expect(result.summary.approved_count).toBe(0);
    expect(result.summary.rejected_count).toBe(0);
    expect(result.summary.pending_count).toBe(0);
    expect(result.summary.total_approved_amount).toBe(0);
    expect(result.expenses).toEqual([]);
  });

  it('related/joined category data resolves correctly under branch scoping without leaking rows', async () => {
    const { supabase } = fakeSupabaseWithRows([
      {
        id: 'e1',
        amount: 75,
        approval_status: 'approved',
        title: null,
        description: null,
        expense_date: '2026-01-05',
        created_at: '2026-01-05T00:00:00.000Z',
        branch_id: BRANCH_A1,
        created_by: 'u1',
        resolved_by: 'u2',
        resolved_at: null,
        category: { id: 'cat-1', name: 'Utilities' },
      },
    ]);
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    const result = await service.getExpensesReport(
      tenantContext(),
      restrictedUser(BRANCH_A1),
      {},
    );

    expect(result.by_category).toEqual([
      { category: 'Utilities', count: 1, total: 75 },
    ]);
  });

  it('inactive/deleted branch → rejected through the existing BranchValidatorService path', async () => {
    const { supabase } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(
      validator(() =>
        Promise.reject(new Error('Branch is inactive or has been deleted')),
      ),
    );
    const service = new ReportsService(supabase, branchAuth);

    await expect(
      service.getExpensesReport(tenantContext(), centralUser(), {
        branch_id: BRANCH_A1,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('regression: Central behavior is unchanged from pre-migration (omitted branch stays tenant-wide)', async () => {
    const { supabase, eqCalls, fromMock } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    await service.getExpensesReport(tenantContext(), centralUser(), {});

    expect(fromMock).toHaveBeenCalledWith('expenses_v2');
    expect(eqCalls.find(([col]) => col === 'branch_id')).toBeUndefined();
  });
});

// Reports Authorization Item 4 (Owner-approved) — GET /reports/customer-churn,
// same pattern as revenue/shifts/expenses above: only the branch-
// authorization wiring is under test, churn math is pre-existing/unchanged.
// getCustomerChurn() issues two `orders` queries (current + previous
// period) against the SAME shared fake chain (fakeSupabase()'s from()
// always returns the one singleton chain), so eqCalls accumulates filters
// from BOTH queries in call order — asserting on the count/order of
// 'branch_id' entries in eqCalls is exactly what proves both period
// queries received the same effective branch scope, not just one of them.
describe('ReportsService.getCustomerChurn — branch authorization', () => {
  it('Central + omitted branch → tenant-wide, no branch_id filter applied to either query', async () => {
    const { supabase, eqCalls, fromMock } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    await service.getCustomerChurn(tenantContext(), centralUser(), {});

    expect(fromMock).toHaveBeenCalledTimes(3);
    expect(eqCalls.filter(([col]) => col === 'branch_id')).toHaveLength(0);
  });

  it('Central + explicit own-tenant branch → BOTH period queries scoped to that branch', async () => {
    const { supabase, eqCalls, fromMock } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    await service.getCustomerChurn(tenantContext(), centralUser(), {
      branch_id: BRANCH_A1,
    });

    expect(fromMock).toHaveBeenCalledTimes(3);
    const branchFilters = eqCalls.filter(([col]) => col === 'branch_id');
    expect(branchFilters).toHaveLength(2);
    expect(branchFilters).toEqual([
      ['branch_id', BRANCH_A1],
      ['branch_id', BRANCH_A1],
    ]);
  });

  it('Central + cross-tenant branch → rejected, no query executed', async () => {
    const { supabase, fromMock } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysInvalid));
    const service = new ReportsService(supabase, branchAuth);

    await expect(
      service.getCustomerChurn(tenantContext(), centralUser(), {
        branch_id: 'branch-of-other-tenant',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('Restricted + omitted branch → automatically scoped to own branch on BOTH period queries', async () => {
    const { supabase, eqCalls, fromMock } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    await service.getCustomerChurn(
      tenantContext(),
      restrictedUser(BRANCH_A1),
      {},
    );

    expect(fromMock).toHaveBeenCalledTimes(3);
    const branchFilters = eqCalls.filter(([col]) => col === 'branch_id');
    expect(branchFilters).toEqual([
      ['branch_id', BRANCH_A1],
      ['branch_id', BRANCH_A1],
    ]);
  });

  it('Restricted + explicit own branch → allowed, both queries scoped', async () => {
    const { supabase, eqCalls, fromMock } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    await service.getCustomerChurn(tenantContext(), restrictedUser(BRANCH_A1), {
      branch_id: BRANCH_A1,
    });

    expect(fromMock).toHaveBeenCalledTimes(3);
    expect(eqCalls.filter(([col]) => col === 'branch_id')).toEqual([
      ['branch_id', BRANCH_A1],
      ['branch_id', BRANCH_A1],
    ]);
  });

  it('Restricted + explicit other branch → rejected, no query executed', async () => {
    const { supabase, fromMock } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    await expect(
      service.getCustomerChurn(tenantContext(), restrictedUser(BRANCH_A1), {
        branch_id: BRANCH_A2,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('Restricted + cross-tenant branch → rejected, no query executed', async () => {
    const { supabase, fromMock } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysInvalid));
    const service = new ReportsService(supabase, branchAuth);

    await expect(
      service.getCustomerChurn(tenantContext(), restrictedUser(BRANCH_A1), {
        branch_id: 'branch-of-other-tenant',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('Restricted + manipulated query branch_id → rejected, cannot expose another branch', async () => {
    const { supabase, fromMock } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    await expect(
      service.getCustomerChurn(tenantContext(), restrictedUser(BRANCH_A1), {
        branch_id: 'someone-elses-branch',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('inactive/deleted branch → rejected through the existing BranchValidatorService path', async () => {
    const { supabase, fromMock } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(
      validator(() =>
        Promise.reject(new Error('Branch is inactive or has been deleted')),
      ),
    );
    const service = new ReportsService(supabase, branchAuth);

    await expect(
      service.getCustomerChurn(tenantContext(), centralUser(), {
        branch_id: BRANCH_A1,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('empty result set → valid zero response, not an error', async () => {
    const { supabase } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    const result = await service.getCustomerChurn(
      tenantContext(),
      restrictedUser(BRANCH_A1),
      {},
    );

    expect(result.previous_period_customers).toBe(0);
    expect(result.current_period_customers).toBe(0);
    expect(result.churned_customers).toBe(0);
    expect(result.churn_rate_pct).toBe(0);
  });

  it('regression: Central behavior is unchanged from pre-migration (omitted branch stays tenant-wide)', async () => {
    const { supabase, eqCalls, fromMock } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    await service.getCustomerChurn(tenantContext(), centralUser(), {});

    expect(fromMock).toHaveBeenCalledWith('orders');
    expect(eqCalls.find(([col]) => col === 'branch_id')).toBeUndefined();
  });
});

// Reports Authorization Item 5 (Owner-approved) — GET /reports/top-items,
// same pattern as revenue/shifts/expenses/customer-churn above: only the
// branch-authorization wiring is under test, ranking/aggregation math is
// pre-existing/unchanged. getTopItems() queries `order_items` with an
// embedded `orders!inner(...)` relation — order_items has no branch_id of
// its own, so the correct (and only correct) scoping mechanism is
// `.eq('orders.branch_id', effectiveBranchId)` on the embedded relation,
// NOT a top-level `.eq('branch_id', ...)`. The existing eq mock records
// the exact column string passed (e.g. 'orders.branch_id' vs 'branch_id'),
// so asserting on that string is what proves filtering happens through
// the embedded relation, not the (non-existent) order_items.branch_id.
describe('ReportsService.getTopItems — branch authorization', () => {
  it('Central + omitted branch → tenant-wide, no orders.branch_id filter applied', async () => {
    const { supabase, eqCalls } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    await service.getTopItems(tenantContext(), centralUser(), {});

    expect(eqCalls.find(([col]) => col === 'orders.branch_id')).toBeUndefined();
    expect(eqCalls).toContainEqual(['orders.tenant_id', TENANT_A]);
  });

  it('Central + explicit own-tenant branch → scoped via orders.branch_id, tenant filter unchanged', async () => {
    const { supabase, eqCalls } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    await service.getTopItems(tenantContext(), centralUser(), {
      branch_id: BRANCH_A1,
    });

    expect(eqCalls).toContainEqual(['orders.branch_id', BRANCH_A1]);
    expect(eqCalls).toContainEqual(['orders.tenant_id', TENANT_A]);
    expect(eqCalls.find(([col]) => col === 'branch_id')).toBeUndefined();
  });

  it('Central + cross-tenant branch → rejected, no query executed', async () => {
    const { supabase, fromMock } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysInvalid));
    const service = new ReportsService(supabase, branchAuth);

    await expect(
      service.getTopItems(tenantContext(), centralUser(), {
        branch_id: 'branch-of-other-tenant',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('Restricted + omitted branch → automatically scoped to own branch via orders.branch_id', async () => {
    const { supabase, eqCalls } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    await service.getTopItems(tenantContext(), restrictedUser(BRANCH_A1), {});

    expect(eqCalls).toContainEqual(['orders.branch_id', BRANCH_A1]);
  });

  it('Restricted + explicit own branch → allowed, scoped via orders.branch_id', async () => {
    const { supabase, eqCalls } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    await service.getTopItems(tenantContext(), restrictedUser(BRANCH_A1), {
      branch_id: BRANCH_A1,
    });

    expect(eqCalls).toContainEqual(['orders.branch_id', BRANCH_A1]);
  });

  it('Restricted + explicit other branch → rejected, no query executed', async () => {
    const { supabase, fromMock } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    await expect(
      service.getTopItems(tenantContext(), restrictedUser(BRANCH_A1), {
        branch_id: BRANCH_A2,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('Restricted + cross-tenant branch → rejected, no query executed', async () => {
    const { supabase, fromMock } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysInvalid));
    const service = new ReportsService(supabase, branchAuth);

    await expect(
      service.getTopItems(tenantContext(), restrictedUser(BRANCH_A1), {
        branch_id: 'branch-of-other-tenant',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('inactive/deleted branch → rejected through the existing BranchValidatorService path', async () => {
    const { supabase, fromMock } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(
      validator(() =>
        Promise.reject(new Error('Branch is inactive or has been deleted')),
      ),
    );
    const service = new ReportsService(supabase, branchAuth);

    await expect(
      service.getTopItems(tenantContext(), centralUser(), {
        branch_id: BRANCH_A1,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('empty result set → valid empty items array, not an error', async () => {
    const { supabase } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    const result = await service.getTopItems(
      tenantContext(),
      restrictedUser(BRANCH_A1),
      {},
    );

    expect(result.items).toEqual([]);
  });

  it('ranking/aggregation remains correct after branch filtering — sums and ranks only the effective branch rows', async () => {
    const { supabase } = fakeSupabaseWithRows([
      {
        item_id: 'item-1',
        item_name: 'Widget',
        qty: 2,
        total_price: 40,
        orders: {
          tenant_id: TENANT_A,
          status: 'completed',
          created_at: '2026-01-05T00:00:00.000Z',
          branch_id: BRANCH_A1,
        },
      },
      {
        item_id: 'item-1',
        item_name: 'Widget',
        qty: 1,
        total_price: 20,
        orders: {
          tenant_id: TENANT_A,
          status: 'completed',
          created_at: '2026-01-06T00:00:00.000Z',
          branch_id: BRANCH_A1,
        },
      },
      {
        item_id: 'item-2',
        item_name: 'Gadget',
        qty: 5,
        total_price: 100,
        orders: {
          tenant_id: TENANT_A,
          status: 'completed',
          created_at: '2026-01-06T00:00:00.000Z',
          branch_id: BRANCH_A1,
        },
      },
    ]);
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    const result = await service.getTopItems(
      tenantContext(),
      restrictedUser(BRANCH_A1),
      {},
    );

    expect(result.items).toEqual([
      { name: 'Gadget', quantity: 5, total: 100, pct: 100 },
      { name: 'Widget', quantity: 3, total: 60, pct: 60 },
    ]);
  });

  it('regression: Central behavior is unchanged from pre-migration (omitted branch stays tenant-wide)', async () => {
    const { supabase, eqCalls, fromMock } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    await service.getTopItems(tenantContext(), centralUser(), {});

    expect(fromMock).toHaveBeenCalledWith('order_items');
    expect(eqCalls.find(([col]) => col === 'orders.branch_id')).toBeUndefined();
  });
});

// Reports Authorization Item 6 (Owner-approved) — GET /reports/recent-activity,
// same pattern as the prior 5 migrations: only the branch-authorization
// wiring is under test, activity mapping/sort/slice is pre-existing/
// unchanged. getRecentActivity() queries `orders` directly — branch_id is
// a top-level column here (no embedded relation like top-items needed),
// so the correct filter is a plain .eq('branch_id', effectiveBranchId).
describe('ReportsService.getRecentActivity — branch authorization', () => {
  it('Central + omitted branch → tenant-wide, no branch_id filter applied', async () => {
    const { supabase, eqCalls } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    await service.getRecentActivity(tenantContext(), centralUser(), {});

    expect(eqCalls.find(([col]) => col === 'branch_id')).toBeUndefined();
    expect(eqCalls).toContainEqual(['tenant_id', TENANT_A]);
  });

  it('Central + explicit same-tenant branch → scoped, tenant filter unchanged', async () => {
    const { supabase, eqCalls } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    await service.getRecentActivity(tenantContext(), centralUser(), {
      branch_id: BRANCH_A1,
    });

    expect(eqCalls).toContainEqual(['branch_id', BRANCH_A1]);
    expect(eqCalls).toContainEqual(['tenant_id', TENANT_A]);
  });

  it('Central + cross-tenant branch → rejected, no query executed', async () => {
    const { supabase, fromMock } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysInvalid));
    const service = new ReportsService(supabase, branchAuth);

    await expect(
      service.getRecentActivity(tenantContext(), centralUser(), {
        branch_id: 'branch-of-other-tenant',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('Restricted + omitted branch → automatically scoped to own branch', async () => {
    const { supabase, eqCalls } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    await service.getRecentActivity(
      tenantContext(),
      restrictedUser(BRANCH_A1),
      {},
    );

    expect(eqCalls).toContainEqual(['branch_id', BRANCH_A1]);
  });

  it('Restricted + explicit own branch → allowed, scoped', async () => {
    const { supabase, eqCalls } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    await service.getRecentActivity(
      tenantContext(),
      restrictedUser(BRANCH_A1),
      { branch_id: BRANCH_A1 },
    );

    expect(eqCalls).toContainEqual(['branch_id', BRANCH_A1]);
  });

  it('Restricted + explicit other branch → rejected, no query executed', async () => {
    const { supabase, fromMock } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    await expect(
      service.getRecentActivity(tenantContext(), restrictedUser(BRANCH_A1), {
        branch_id: BRANCH_A2,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('Restricted + cross-tenant branch → rejected, no query executed', async () => {
    const { supabase, fromMock } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysInvalid));
    const service = new ReportsService(supabase, branchAuth);

    await expect(
      service.getRecentActivity(tenantContext(), restrictedUser(BRANCH_A1), {
        branch_id: 'branch-of-other-tenant',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('inactive/deleted branch → rejected through the existing BranchValidatorService path', async () => {
    const { supabase, fromMock } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(
      validator(() =>
        Promise.reject(new Error('Branch is inactive or has been deleted')),
      ),
    );
    const service = new ReportsService(supabase, branchAuth);

    await expect(
      service.getRecentActivity(tenantContext(), centralUser(), {
        branch_id: BRANCH_A1,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('branch filtering is applied before .order()/.limit() in the query chain', async () => {
    const { supabase } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);
    const chain = supabase as unknown as {
      eq: jest.Mock;
      order: jest.Mock;
      limit: jest.Mock;
    };

    await service.getRecentActivity(
      tenantContext(),
      restrictedUser(BRANCH_A1),
      {},
    );

    const eqOrder = chain.eq.mock.invocationCallOrder;
    const branchEqCallIndex = chain.eq.mock.calls.findIndex(
      ([col]) => col === 'branch_id',
    );
    const branchEqOrder = eqOrder[branchEqCallIndex];
    const orderCallOrder = chain.order.mock.invocationCallOrder[0];
    const limitCallOrder = chain.limit.mock.invocationCallOrder[0];

    expect(branchEqOrder).toBeLessThan(orderCallOrder);
    expect(branchEqOrder).toBeLessThan(limitCallOrder);
  });

  it('response mapping remains correct with rows from the effective branch only', async () => {
    const { supabase } = fakeSupabaseWithRows([
      {
        id: 'order-aaaa1234',
        total: 150,
        payment_method: 'card',
        status: 'completed',
        created_at: '2026-01-06T00:00:00.000Z',
      },
      {
        id: 'order-bbbb5678',
        total: 50,
        payment_method: 'cash',
        status: 'cancelled',
        created_at: '2026-01-05T00:00:00.000Z',
      },
    ]);
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    const result = await service.getRecentActivity(
      tenantContext(),
      restrictedUser(BRANCH_A1),
      {},
    );

    expect(result.activity).toEqual([
      {
        type: 'order',
        title: 'فاتورة #1234',
        sub: 'card',
        amount: 150,
        time: '2026-01-06T00:00:00.000Z',
      },
      {
        type: 'refund',
        title: 'فاتورة #5678',
        sub: 'cash',
        amount: -50,
        time: '2026-01-05T00:00:00.000Z',
      },
    ]);
  });

  it('empty response → valid empty activity array, not an error', async () => {
    const { supabase } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    const result = await service.getRecentActivity(
      tenantContext(),
      restrictedUser(BRANCH_A1),
      {},
    );

    expect(result.activity).toEqual([]);
  });

  it('regression: Central behavior is unchanged from pre-migration (omitted branch stays tenant-wide)', async () => {
    const { supabase, eqCalls, fromMock } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    await service.getRecentActivity(tenantContext(), centralUser(), {});

    expect(fromMock).toHaveBeenCalledWith('orders');
    expect(eqCalls.find(([col]) => col === 'branch_id')).toBeUndefined();
  });
});
// Customer Domain Phase 13 (Owner-approved) — getSparklines() issues three
// independent queries in one call (orders, customer_branch_relationships,
// expenses), unlike every other endpoint above which issues exactly one —
// fakeSupabase()/fakeSupabaseWithRows() return identical rows regardless
// of table name, which breaks as soon as a test needs realistic data on
// more than one of those three. This fake instead resolves per-table, and
// records every .eq()/.gte()/.lte() call tagged with the table it was
// called against, so a test can assert "branch_id was applied to
// customer_branch_relationships" without also asserting anything about
// the (unchanged, out of this phase's scope) orders/expenses queries.
interface TaggedCall {
  table: string;
  method: string;
  args: unknown[];
}

function fakeSupabaseByTable(rowsByTable: Record<string, unknown[]>): {
  supabase: SupabaseClient;
  calls: TaggedCall[];
  fromMock: jest.Mock;
} {
  // Phase 1: day boundaries use the tenant timezone; these legacy fixtures
  // assert UTC-day math, so the tenant defaults to UTC unless overridden.
  rowsByTable = { tenants: [{ timezone: 'UTC' }], ...rowsByTable };
  const calls: TaggedCall[] = [];
  let currentTable = '';
  const fromMock = jest.fn((table: string) => {
    currentTable = table;
    return chain;
  });
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push({ table: currentTable, method, args });
      return chain;
    };
  const chain = {
    from: fromMock,
    select: jest.fn(() => chain),
    eq: jest.fn(record('eq')),
    gte: jest.fn(record('gte')),
    lte: jest.fn(record('lte')),
    is: jest.fn(() => chain),
    not: jest.fn(() => chain),
    in: jest.fn(() => chain),
    order: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    single: jest.fn(() =>
      Promise.resolve({
        data: (rowsByTable[currentTable] ?? [])[0] ?? null,
        error: null,
      }),
    ),
    maybeSingle: jest.fn(() =>
      Promise.resolve({
        data: (rowsByTable[currentTable] ?? [])[0] ?? null,
        error: null,
      }),
    ),
    then: (resolve: (v: { data: unknown[]; error: null }) => void) =>
      resolve({ data: rowsByTable[currentTable] ?? [], error: null }),
  };
  const rpc = jest.fn((fnName: string) => {
    calls.push({ table: fnName, method: 'rpc', args: [] });
    return Promise.resolve({ data: rowsByTable[fnName] ?? [], error: null });
  });
  return {
    supabase: { ...chain, rpc },
    calls,
    fromMock,
  };
}

describe('ReportsService.getSparklines — customer series (Phase 13)', () => {
  const today = new Date().toISOString().substring(0, 10);
  const sevenDaysAgo = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return d.toISOString().substring(0, 10);
  })();

  it('Central + omitted branch → distinct customers tenant-wide, no branch_id filter on relationships', async () => {
    const { supabase, calls } = fakeSupabaseByTable({
      customer_branch_relationships: [
        { customer_id: 'cust-1', first_seen_at: `${today}T10:00:00.000Z` },
        { customer_id: 'cust-2', first_seen_at: `${today}T11:00:00.000Z` },
      ],
    });
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    const result = await service.getSparklines(
      tenantContext(),
      centralUser(),
      {},
    );

    const relCalls = calls.filter(
      (c) => c.table === 'customer_branch_relationships',
    );
    expect(
      relCalls.find((c) => c.method === 'eq' && c.args[0] === 'branch_id'),
    ).toBeUndefined();
    expect(result.customers[6]).toBe(2);
  });

  it('Restricted branch → automatically scoped to own branch on customer_branch_relationships', async () => {
    const { supabase, calls } = fakeSupabaseByTable({
      customer_branch_relationships: [
        { customer_id: 'cust-1', first_seen_at: `${today}T10:00:00.000Z` },
      ],
    });
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    await service.getSparklines(tenantContext(), restrictedUser(BRANCH_A1), {});

    const relCalls = calls.filter(
      (c) => c.table === 'customer_branch_relationships',
    );
    expect(relCalls).toContainEqual(
      expect.objectContaining({ method: 'eq', args: ['branch_id', BRANCH_A1] }),
    );
  });

  it('a customer created elsewhere but with a NEW relationship to this branch today counts (+1), independent of customers.created_at', async () => {
    // The relationship row itself is what's queried — the fake never
    // touches a customers table at all for this series, proving the
    // source is customer_branch_relationships, not customers.created_at.
    const { supabase } = fakeSupabaseByTable({
      customer_branch_relationships: [
        {
          customer_id: 'old-customer',
          first_seen_at: `${today}T09:00:00.000Z`,
        },
      ],
    });
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    const result = await service.getSparklines(
      tenantContext(),
      restrictedUser(BRANCH_A1),
      {},
    );
    expect(result.customers[6]).toBe(1);
  });

  it('same customer with relationships at two branches on the same day counts once for Central, once for each branch independently', async () => {
    const rows = [
      {
        customer_id: 'cust-shared',
        branch_id: BRANCH_A1,
        first_seen_at: `${today}T09:00:00.000Z`,
      },
      {
        customer_id: 'cust-shared',
        branch_id: BRANCH_A2,
        first_seen_at: `${today}T09:30:00.000Z`,
      },
    ];

    const central = fakeSupabaseByTable({
      customer_branch_relationships: rows,
    });
    const centralService = new ReportsService(
      central.supabase,
      new BranchAuthorizationService(validator(alwaysValid)),
    );
    const centralResult = await centralService.getSparklines(
      tenantContext(),
      centralUser(),
      {},
    );
    expect(centralResult.customers[6]).toBe(1);

    const branchA1 = fakeSupabaseByTable({
      customer_branch_relationships: rows.filter(
        (r) => r.branch_id === BRANCH_A1,
      ),
    });
    const branchA1Service = new ReportsService(
      branchA1.supabase,
      new BranchAuthorizationService(validator(alwaysValid)),
    );
    const branchA1Result = await branchA1Service.getSparklines(
      tenantContext(),
      restrictedUser(BRANCH_A1),
      {},
    );
    expect(branchA1Result.customers[6]).toBe(1);
  });

  it('relationship outside the 7-day date range is excluded', async () => {
    const { supabase } = fakeSupabaseByTable({
      customer_branch_relationships: [
        { customer_id: 'cust-old', first_seen_at: '2020-01-01T00:00:00.000Z' },
      ],
    });
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    const result = await service.getSparklines(
      tenantContext(),
      centralUser(),
      {},
    );
    expect(result.customers.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('exact lower boundary (00:00:00.000 on the first day) is included', async () => {
    const { supabase } = fakeSupabaseByTable({
      customer_branch_relationships: [
        {
          customer_id: 'cust-boundary',
          first_seen_at: `${sevenDaysAgo}T00:00:00.000Z`,
        },
      ],
    });
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    const result = await service.getSparklines(
      tenantContext(),
      centralUser(),
      {},
    );
    expect(result.customers[0]).toBe(1);
  });

  it('exact upper boundary (23:59:59.999 on the last day) is included', async () => {
    const { supabase } = fakeSupabaseByTable({
      customer_branch_relationships: [
        {
          customer_id: 'cust-boundary',
          first_seen_at: `${today}T23:59:59.999Z`,
        },
      ],
    });
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    const result = await service.getSparklines(
      tenantContext(),
      centralUser(),
      {},
    );
    expect(result.customers[6]).toBe(1);
  });

  it('just-before-boundary and just-after-boundary land on the correct adjacent day, not double-counted', async () => {
    const justBefore = `${sevenDaysAgo}T00:00:00.000Z`;
    const { supabase } = fakeSupabaseByTable({
      customer_branch_relationships: [
        { customer_id: 'cust-a', first_seen_at: justBefore },
      ],
    });
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    const result = await service.getSparklines(
      tenantContext(),
      centralUser(),
      {},
    );
    expect(result.customers[0]).toBe(1);
    expect(result.customers.slice(1).every((n) => n === 0)).toBe(true);
  });

  it('cross-tenant branch_id is rejected with no query executed (same as every other migrated endpoint)', async () => {
    const { supabase, fromMock } = fakeSupabaseByTable({});
    const branchAuth = new BranchAuthorizationService(validator(alwaysInvalid));
    const service = new ReportsService(supabase, branchAuth);

    await expect(
      service.getSparklines(tenantContext(), centralUser(), {
        branch_id: 'branch-of-other-tenant',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('no relationships at all → zero customer series, other series unaffected', async () => {
    const { supabase } = fakeSupabaseByTable({});
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    const result = await service.getSparklines(
      tenantContext(),
      centralUser(),
      {},
    );
    expect(result.customers).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(result.sales).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(result.orders).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(result.expenses).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it('response shape is unchanged: sales/orders/customers/expenses, each a 7-element array', async () => {
    const { supabase } = fakeSupabaseByTable({});
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    const result = await service.getSparklines(
      tenantContext(),
      centralUser(),
      {},
    );
    expect(Object.keys(result).sort()).toEqual([
      'customers',
      'expenses',
      'orders',
      'sales',
    ]);
    expect(result.sales).toHaveLength(7);
    expect(result.orders).toHaveLength(7);
    expect(result.customers).toHaveLength(7);
    expect(result.expenses).toHaveLength(7);
  });

  it('sales/orders/expenses series remain tenant-wide (unscoped), out of this approved phase scope', async () => {
    const { supabase, calls } = fakeSupabaseByTable({
      orders: [{ total: 50, created_at: `${today}T10:00:00.000Z` }],
    });
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    await service.getSparklines(tenantContext(), restrictedUser(BRANCH_A1), {});

    const orderCalls = calls.filter((c) => c.table === 'orders');
    expect(
      orderCalls.find((c) => c.method === 'eq' && c.args[0] === 'branch_id'),
    ).toBeUndefined();
  });
});

// Branch Domain Batch 1, B3 (Owner-approved) — the 5 previously-unmigrated
// Reports endpoints (tax, payments, cogs, daily-reconciliation, comparison)
// now reuse the same resolveReportBranchScope wiring as revenue/shifts/
// expenses/customer-churn/top-items/recent-activity/sparklines above. Each
// block only asserts the authorization wiring, same scope as those
// existing sibling suites — the report's own math is pre-existing/
// unchanged. getInventoryReport and getBranchComparison are deliberately
// NOT covered here — see the Branch Batch 1 B3 report for why.
describe('ReportsService.getTaxReport — branch authorization', () => {
  it('Central + omitted branch → tenant-wide, no branch_id filter applied', async () => {
    const { supabase, eqCalls } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);
    await service.getTaxReport(tenantContext(), centralUser(), {});
    expect(eqCalls.find(([col]) => col === 'branch_id')).toBeUndefined();
  });

  it('Restricted + omitted branch → forced to own branch', async () => {
    const { supabase, eqCalls } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);
    await service.getTaxReport(tenantContext(), restrictedUser(BRANCH_A1), {});
    expect(eqCalls).toContainEqual(['branch_id', BRANCH_A1]);
  });

  it('Restricted + other branch (explicit) → rejected, no query executed', async () => {
    const { supabase, fromMock } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);
    await expect(
      service.getTaxReport(tenantContext(), restrictedUser(BRANCH_A1), {
        branch_id: BRANCH_A2,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('Cross-tenant branch → rejected', async () => {
    const { supabase } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysInvalid));
    const service = new ReportsService(supabase, branchAuth);
    await expect(
      service.getTaxReport(tenantContext(), centralUser(), {
        branch_id: 'branch-of-other-tenant',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('ReportsService.getPaymentsReport — branch authorization', () => {
  it('Central + omitted branch → tenant-wide, no branch_id filter applied', async () => {
    const { supabase, eqCalls } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);
    await service.getPaymentsReport(tenantContext(), centralUser(), {});
    expect(eqCalls.find(([col]) => col === 'branch_id')).toBeUndefined();
  });

  it('Restricted + omitted branch → forced to own branch', async () => {
    const { supabase, eqCalls } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);
    await service.getPaymentsReport(
      tenantContext(),
      restrictedUser(BRANCH_A1),
      {},
    );
    expect(eqCalls).toContainEqual(['branch_id', BRANCH_A1]);
  });

  it('Restricted + other branch (explicit) → rejected, no query executed', async () => {
    const { supabase, fromMock } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);
    await expect(
      service.getPaymentsReport(tenantContext(), restrictedUser(BRANCH_A1), {
        branch_id: BRANCH_A2,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('Cross-tenant branch → rejected', async () => {
    const { supabase } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysInvalid));
    const service = new ReportsService(supabase, branchAuth);
    await expect(
      service.getPaymentsReport(tenantContext(), centralUser(), {
        branch_id: 'branch-of-other-tenant',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('ReportsService.getCogsReport — branch authorization', () => {
  it('Central + omitted branch → tenant-wide, no branch_id filter applied to the orders sub-query', async () => {
    const { supabase, calls } = fakeSupabaseByTable({});
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);
    await service.getCogsReport(tenantContext(), centralUser(), {});
    const orderCalls = calls.filter((c) => c.table === 'orders');
    expect(
      orderCalls.find((c) => c.method === 'eq' && c.args[0] === 'branch_id'),
    ).toBeUndefined();
  });

  it('Restricted + omitted branch → orders sub-query forced to own branch', async () => {
    const { supabase, calls } = fakeSupabaseByTable({});
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);
    await service.getCogsReport(tenantContext(), restrictedUser(BRANCH_A1), {});
    const orderCalls = calls.filter((c) => c.table === 'orders');
    expect(orderCalls).toContainEqual(
      expect.objectContaining({ method: 'eq', args: ['branch_id', BRANCH_A1] }),
    );
  });

  it('Restricted + other branch (explicit) → rejected, no query executed', async () => {
    const { supabase, fromMock } = fakeSupabaseByTable({});
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);
    await expect(
      service.getCogsReport(tenantContext(), restrictedUser(BRANCH_A1), {
        branch_id: BRANCH_A2,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(fromMock).not.toHaveBeenCalled();
  });
});

describe('ReportsService.getDailyReconciliation — branch authorization', () => {
  const DATE = '2026-01-15';

  it('Central + omitted branch → tenant-wide, no branch_id filter applied', async () => {
    const { supabase, calls } = fakeSupabaseByTable({});
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);
    await service.getDailyReconciliation(tenantContext(), centralUser(), DATE);
    const orderCalls = calls.filter((c) => c.table === 'orders');
    expect(
      orderCalls.find((c) => c.method === 'eq' && c.args[0] === 'branch_id'),
    ).toBeUndefined();
  });

  it('Restricted + omitted branch → orders/expenses/shifts all forced to own branch', async () => {
    const { supabase, calls } = fakeSupabaseByTable({});
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);
    await service.getDailyReconciliation(
      tenantContext(),
      restrictedUser(BRANCH_A1),
      DATE,
    );
    for (const table of ['orders', 'expenses_v2', 'shifts']) {
      const tableCalls = calls.filter((c) => c.table === table);
      expect(
        tableCalls.find((c) => c.method === 'eq' && c.args[0] === 'branch_id'),
      ).toEqual(expect.objectContaining({ args: ['branch_id', BRANCH_A1] }));
    }
  });

  it('Restricted + other branch (explicit) → rejected, no query executed', async () => {
    const { supabase, fromMock } = fakeSupabaseByTable({});
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);
    await expect(
      service.getDailyReconciliation(
        tenantContext(),
        restrictedUser(BRANCH_A1),
        DATE,
        BRANCH_A2,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(fromMock).not.toHaveBeenCalled();
  });
});

describe('ReportsService.getPeriodComparison — branch authorization', () => {
  it('Central + omitted branch → tenant-wide, no branch_id filter applied', async () => {
    const { supabase, eqCalls } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);
    await service.getPeriodComparison(tenantContext(), centralUser(), {});
    expect(eqCalls.find(([col]) => col === 'branch_id')).toBeUndefined();
  });

  it('Restricted + omitted branch → forced to own branch for both current and previous period', async () => {
    const { supabase, eqCalls } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);
    await service.getPeriodComparison(
      tenantContext(),
      restrictedUser(BRANCH_A1),
      {},
    );
    const branchFilters = eqCalls.filter(([col]) => col === 'branch_id');
    expect(branchFilters.length).toBe(2); // current + previous period queries
    expect(branchFilters.every(([, val]) => val === BRANCH_A1)).toBe(true);
  });

  it('Restricted + other branch (explicit) → rejected, no query executed', async () => {
    const { supabase, fromMock } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);
    await expect(
      service.getPeriodComparison(tenantContext(), restrictedUser(BRANCH_A1), {
        branch_id: BRANCH_A2,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('Cross-tenant branch → rejected', async () => {
    const { supabase } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysInvalid));
    const service = new ReportsService(supabase, branchAuth);
    await expect(
      service.getPeriodComparison(tenantContext(), centralUser(), {
        branch_id: 'branch-of-other-tenant',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

// Branch Domain Batch 2 (Owner-approved) — warehouse_id -> branch_id ->
// resolveReportBranchScope authorization for /reports/inventory. There is
// no branch_id param on this endpoint by design; these tests exercise the
// warehouse-ownership resolution specifically.
describe('ReportsService.getInventoryReport — warehouse-branch authorization', () => {
  it('Central + explicit warehouse in the tenant → allowed, RPC executes', async () => {
    const { supabase, calls } = fakeSupabaseByTable({
      warehouses: [{ branch_id: BRANCH_A1 }],
    });
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);
    await service.getInventoryReport(tenantContext(), centralUser(), 'wh-1');
    expect(
      calls.some(
        (c) =>
          c.method === 'rpc' &&
          c.table === 'fn_inventory_stock_levels_enriched',
      ),
    ).toBe(true);
  });

  it('Restricted A + warehouse belonging to branch A → allowed', async () => {
    const { supabase } = fakeSupabaseByTable({
      warehouses: [{ branch_id: BRANCH_A1 }],
    });
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);
    await expect(
      service.getInventoryReport(
        tenantContext(),
        restrictedUser(BRANCH_A1),
        'wh-1',
      ),
    ).resolves.toBeDefined();
  });

  it('Restricted A + warehouse belonging to branch B → rejected, RPC never executes', async () => {
    const { supabase, calls } = fakeSupabaseByTable({
      warehouses: [{ branch_id: BRANCH_A2 }],
    });
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);
    await expect(
      service.getInventoryReport(
        tenantContext(),
        restrictedUser(BRANCH_A1),
        'wh-1',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(calls.some((c) => c.method === 'rpc')).toBe(false);
  });

  it('non-existent warehouse → rejected cleanly', async () => {
    const { supabase } = fakeSupabaseByTable({ warehouses: [] });
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);
    await expect(
      service.getInventoryReport(tenantContext(), centralUser(), 'wh-missing'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('Restricted actor with no warehouse_id at all → rejected (no tenant-wide fallback for a restricted actor)', async () => {
    const { supabase } = fakeSupabaseByTable({});
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);
    await expect(
      service.getInventoryReport(tenantContext(), restrictedUser(BRANCH_A1)),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('Central with no warehouse_id → allowed, tenant-wide (unchanged existing behavior)', async () => {
    const { supabase } = fakeSupabaseByTable({});
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);
    await expect(
      service.getInventoryReport(tenantContext(), centralUser()),
    ).resolves.toBeDefined();
  });
});

describe('ReportsService.getBranchComparison — deliberately unchanged (B3)', () => {
  it("lists every tenant branch and computes each one's own metrics — genuinely tenant-wide by design, not narrowed by any caller-supplied branch_id", async () => {
    const { supabase, calls } = fakeSupabaseByTable({
      branches: [
        { id: BRANCH_A1, name: 'Branch A1' },
        { id: BRANCH_A2, name: 'Branch A2' },
      ],
    });
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);
    // query.branch_id is deliberately passed but must have zero effect —
    // getBranchComparison() never reads it, by design (see the controller
    // comment for why this endpoint is intentionally left unmigrated).
    const result = await service.getBranchComparison(tenantContext(), {
      branch_id: BRANCH_A1,
    });
    expect(
      result.branches.map((b: { branch_id: string }) => b.branch_id).sort(),
    ).toEqual([BRANCH_A1, BRANCH_A2].sort());
    const orderCalls = calls.filter((c) => c.table === 'orders');
    const branchFilters = orderCalls
      .filter((c) => c.method === 'eq' && c.args[0] === 'branch_id')
      .map((c) => c.args[1]);
    // One filter per branch (each branch's own metrics), never limited to
    // just the caller-supplied branch_id.
    expect(branchFilters.sort()).toEqual([BRANCH_A1, BRANCH_A2].sort());
  });
});

// Phase 1 (owner approved 2026-11-09): day boundaries follow the tenant
// timezone, not UTC. A sale at 00:45 local Riyadh time (21:45Z of the
// previous UTC day) must belong to the local day.
describe('ReportsService.getRevenueReport — tenant timezone day boundaries (phase 1)', () => {
  it('custom bare dates are local days: 2026-11-09 Riyadh = 2026-11-08T21:00Z .. 2026-11-09T20:59:59.999Z', async () => {
    const { supabase } = fakeSupabaseByTable({
      tenants: [{ timezone: 'Asia/Riyadh' }],
      orders: [],
    });
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    const result = await service.getRevenueReport(
      tenantContext(),
      centralUser(),
      {
        period: 'custom',
        from: '2026-11-09',
        to: '2026-11-09',
      } as never,
    );
    expect(result.period.from).toBe('2026-11-08T21:00:00.000Z');
    expect(result.period.to).toBe('2026-11-09T20:59:59.999Z');
  });

  it('a sale at 00:45 local (21:45Z previous day) is bucketed on the local day', async () => {
    const { supabase } = fakeSupabaseByTable({
      tenants: [{ timezone: 'Asia/Riyadh' }],
      orders: [
        {
          id: 'o1',
          total: 5.75,
          subtotal: 5,
          discount: 0,
          tax: 0.75,
          payment_method: 'cash',
          created_at: '2026-11-08T21:45:00.000Z',
          branch_id: BRANCH_A1,
        },
      ],
    });
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    const result = await service.getRevenueReport(
      tenantContext(),
      centralUser(),
      {
        period: 'custom',
        from: '2026-11-03',
        to: '2026-11-09',
      } as never,
    );
    expect(result.daily_breakdown).toEqual([
      expect.objectContaining({ date: '2026-11-09' }),
    ]);
  });
});

describe('ReportsService.getRevenueReport — cancelled figure (phase 3a)', () => {
  it('also queries the cancelled orders of the period and reports count + total, apart from revenue', async () => {
    const { supabase, eqCalls } = fakeSupabase();
    const branchAuth = new BranchAuthorizationService(validator(alwaysValid));
    const service = new ReportsService(supabase, branchAuth);

    const result = await service.getRevenueReport(tenantContext(), centralUser(), {
      period: 'custom',
      from: '2026-11-03',
      to: '2026-11-09',
    } as never);

    expect(eqCalls).toContainEqual(['status', 'completed']);
    expect(eqCalls).toContainEqual(['status', 'cancelled']);
    expect(result.summary.cancelled_orders).toBe(0);
    expect(result.summary.cancelled_total).toBe(0);
    // Phase 3b: returns (refunds) of the period are reported apart as well.
    expect(result.summary.returned_orders).toBe(0);
    expect(result.summary.returned_total).toBe(0);
  });
});

describe('ReportsService.getExpensesReport - expenses_v2, before VAT (T10 / R1)', () => {
  const row = (over: Record<string, unknown>) => ({
    id: 'e',
    amount: 100,
    approval_status: 'approved',
    title: 'x',
    description: null,
    created_at: '2026-01-05T00:00:00.000Z',
    expense_date: '2026-01-05',
    branch_id: BRANCH_A1,
    created_by: 'u1',
    resolved_by: null,
    resolved_at: null,
    category: { id: 'cat-1', name: 'Utilities' },
    ...over,
  });

  it('reads expenses_v2, never the legacy expenses table, and excludes cancelled ones in the query', async () => {
    const { supabase, calls } = fakeSupabaseByTable({ expenses_v2: [] });
    const service = new ReportsService(
      supabase,
      new BranchAuthorizationService(validator(alwaysValid)),
    );
    await service.getExpensesReport(tenantContext(), centralUser(), {
      period: 'custom',
      from: '2026-01-01',
      to: '2026-01-31',
    } as never);
    expect(calls.some((c) => c.table === 'expenses')).toBe(false);
    expect(
      calls.some((c) => c.table === 'expenses_v2' && c.method === 'gte'),
    ).toBe(true);
    const gte = calls.find(
      (c) => c.table === 'expenses_v2' && c.method === 'gte',
    )!;
    expect(gte.args).toEqual(['expense_date', '2026-01-01']);
    const lte = calls.find(
      (c) => c.table === 'expenses_v2' && c.method === 'lte',
    )!;
    expect(lte.args).toEqual(['expense_date', '2026-01-31']);
  });

  it("amounts are BEFORE VAT: it sums the 'amount' column; 'accepted' counts as approved, 'pending_action' as pending, 'rejected' apart", async () => {
    const { supabase } = fakeSupabaseByTable({
      expenses_v2: [
        row({ id: 'a', amount: 100, approval_status: 'approved' }),
        row({ id: 'b', amount: 50, approval_status: 'accepted' }),
        row({ id: 'c', amount: 30, approval_status: 'pending_action' }),
        row({ id: 'd', amount: 20, approval_status: 'rejected' }),
      ],
    });
    const service = new ReportsService(
      supabase,
      new BranchAuthorizationService(validator(alwaysValid)),
    );
    const r = await service.getExpensesReport(tenantContext(), centralUser(), {
      period: 'custom',
      from: '2026-01-01',
      to: '2026-01-31',
    } as never);
    expect(r.summary.total_approved_amount).toBe(150);
    expect(r.summary.approved_count).toBe(2);
    expect(r.summary.pending_count).toBe(1);
    expect(r.summary.rejected_count).toBe(1);
    expect(r.summary.amount_basis).toBe('before_tax');
  });
});

describe('ReportsService.getCogsReport - real sales only, net revenue (T10 / R2)', () => {
  const run = async (rows: Record<string, unknown[]>) => {
    const { supabase } = fakeSupabaseByTable(rows);
    const service = new ReportsService(
      supabase,
      new BranchAuthorizationService(validator(alwaysValid)),
    );
    return service.getCogsReport(tenantContext(), centralUser(), {
      period: 'custom',
      from: '2026-11-01',
      to: '2026-11-30',
    } as never);
  };

  it('cost = sales minus the stock that came back; margin on revenue WITHOUT VAT', async () => {
    const r = await run({
      stock_movements: [
        { item_id: 'i1', quantity: 3, unit_cost: 4, total_cost: 12, movement_type: 'sale' },
        { item_id: 'i1', quantity: 1, unit_cost: 4, total_cost: 4, movement_type: 'sale_return' },
      ],
      items: [{ id: 'i1', name: 'Soap' }],
      // 100 sales, 15 VAT, 5 discount -> net revenue 95; total 110
      orders: [{ subtotal: 100, discount: 5, total: 110 }],
      sales_returns: [],
    });
    expect(r.summary.total_cogs).toBe(8);
    expect(r.summary.total_revenue).toBe(95);
    expect(r.summary.total_sales_incl_tax).toBe(110);
    expect(r.summary.gross_profit).toBe(87);
    expect(r.top_by_cost[0]).toMatchObject({ item_name: 'Soap', quantity_sold: 2, total_cost: 8 });
  });

  it('a sales return reduces net revenue in the margin', async () => {
    const r = await run({
      stock_movements: [],
      orders: [{ subtotal: 100, discount: 0, total: 115 }],
      sales_returns: [{ net_amount: 20 }],
    });
    expect(r.summary.total_revenue).toBe(80);
  });
});

describe('ReportsService - sales_returns not created yet (T10 / R12)', () => {
  it('the revenue report still works when the sales_returns table does not exist', async () => {
    // fakeSupabaseByTable resolves every table; wrap it so sales_returns errors like PostgREST does.
    const { supabase } = fakeSupabaseByTable({ orders: [] });
    const chain = supabase as unknown as { from: (t: string) => unknown; then?: unknown };
    const realFrom = chain.from.bind(supabase);
    let current = '';
    (supabase as unknown as { from: unknown }).from = (t: string) => {
      current = t;
      return realFrom(t);
    };
    const proto = realFrom('orders') as { then: (r: (v: unknown) => void) => void };
    const originalThen = proto.then.bind(proto);
    proto.then = (resolve: (v: unknown) => void) =>
      current === 'sales_returns'
        ? resolve({ data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.sales_returns' in the schema cache" } })
        : originalThen(resolve);

    const service = new ReportsService(
      supabase,
      new BranchAuthorizationService(validator(alwaysValid)),
    );
    const r = await service.getRevenueReport(tenantContext(), centralUser(), {
      period: 'custom',
      from: '2026-11-01',
      to: '2026-11-30',
    } as never);
    expect(r.summary.returned_orders).toBe(0);
    expect(r.summary.returned_total).toBe(0);
  });
});

describe('ReportsService - T10 figures that must add up', () => {
  const svc = (rows: Record<string, unknown[]>) => {
    const { supabase } = fakeSupabaseByTable(rows);
    return new ReportsService(
      supabase,
      new BranchAuthorizationService(validator(alwaysValid)),
    );
  };
  const q = { period: 'custom', from: '2026-11-01', to: '2026-11-30' } as never;

  it('R7 tax: shows the discount and the net subtotal (subtotal - discount + tax = total)', async () => {
    const r = await svc({
      orders: [{ id: 'o1', subtotal: 110, discount: 3, tax: 16.05, total: 123.05, branch_id: 'b', created_at: '2026-11-09T10:00:00.000Z' }],
    }).getTaxReport(tenantContext(), centralUser(), q);
    expect(r.summary.total_subtotal).toBe(110);
    expect(r.summary.total_discount).toBe(3);
    expect(r.summary.net_subtotal).toBe(107);
    expect(r.summary.net_subtotal + r.summary.total_tax_collected).toBeCloseTo(r.summary.grand_total, 2);
  });

  it('R6 employees: orders without a cashier appear as one unassigned row (cashier_id null)', async () => {
    const r = await svc({
      orders: [
        { id: 'o1', total: 100, cashier_id: 'u1', branch_id: 'b', created_at: '2026-11-09T10:00:00.000Z' },
        { id: 'o2', total: 40, cashier_id: null, branch_id: 'b', created_at: '2026-11-09T11:00:00.000Z' },
      ],
      users: [{ id: 'u1', name: 'Cashier One', commission_rate: null }],
    }).getEmployeesReport(tenantContext(), q);
    const unassigned = r.employees.find((e) => e.cashier_id === null)!;
    expect(unassigned).toMatchObject({ name: null, order_count: 1, total_sales: 40 });
    expect(r.employees.reduce((s, e) => s + e.total_sales, 0)).toBe(140);
  });

  it('R8 shifts report: shortage and overage are reported apart from the absolute total', async () => {
    const r = await svc({
      shifts: [
        { id: 's1', status: 'closed', discrepancy: -7.42 },
        { id: 's2', status: 'closed', discrepancy: 3 },
      ],
    }).getShiftsReport(tenantContext(), centralUser(), q);
    expect(r.summary.total_discrepancy).toBe(10.42);
    expect(r.summary.shortage_total).toBe(7.42);
    expect(r.summary.overage_total).toBe(3);
    expect(r.summary.net_discrepancy).toBe(-4.42);
  });

  it('R8/R9 daily reconciliation: exposes shortage/overage and the cancelled / returned figures of the day', async () => {
    // NOTE: fakeSupabaseByTable resolves concurrent queries with the LAST
    // table touched, so every query sees the sales_returns rows here; the
    // shifts arithmetic itself is covered by the shifts report test above.
    const r = await svc({
      sales_returns: [{ refund_total: 10.35 }],
    }).getDailyReconciliation(tenantContext(), centralUser(), '2026-11-09');
    expect(r.sales.returned_count).toBe(1);
    expect(r.sales.returned_amount).toBe(10.35);
    expect(typeof r.sales.cancelled_count).toBe('number');
    expect(typeof r.sales.cancelled_amount).toBe('number');
    expect(typeof r.cash_shifts.shortage_total).toBe('number');
    expect(typeof r.cash_shifts.overage_total).toBe('number');
  });

  it('R4 revenue: net_revenue is revenue WITHOUT VAT and after returns', async () => {
    const r = await svc({
      orders: [{ id: 'o1', total: 115, subtotal: 100, discount: 0, tax: 15, payment_method: 'cash', created_at: '2026-11-09T10:00:00.000Z', branch_id: 'b' }],
      sales_returns: [],
    }).getRevenueReport(tenantContext(), centralUser(), q);
    expect(r.summary.total_revenue).toBe(115);
    expect(r.summary.net_revenue).toBe(100);
    expect(r.summary.net_revenue_after_returns).toBe(100);
  });
});
