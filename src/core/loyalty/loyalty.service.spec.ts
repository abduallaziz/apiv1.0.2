import { BadRequestException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { LoyaltyService } from './loyalty.service';
import { LoyaltyTiersRepository } from './loyalty-tiers.repository';
import { TenantSessionService } from '../tenant/tenant-session.service';

// Customer Domain Phase 7 (Owner-approved) — targeted tests for the
// SHARED/BRANCH loyalty scope decision, which lives entirely in
// LoyaltyService (never inside fn_adjust_loyalty_points, per the approved
// architecture). Follows the same "stub the external dependency, exercise
// the real service" convention established throughout this project's
// branch-authorization test suites.

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const CUSTOMER_1 = 'customer-1';
const BRANCH_A = 'branch-a';
const BRANCH_B = 'branch-b';

interface Fixtures {
  loyaltyScope?: string | null;
  customerExists?: boolean;
  ledgerRows?: {
    tenant_id: string;
    customer_id: string;
    branch_id: string | null;
    delta: number;
  }[];
  rpcResult?: { data: unknown; error: unknown };
}

function fakeSupabase(fixtures: Fixtures) {
  const {
    loyaltyScope = 'shared',
    customerExists = true,
    ledgerRows = [],
    rpcResult = {
      data: [{ loyalty_points: 100, lifetime_points_earned: 100 }],
      error: null,
    },
  } = fixtures;

  const ledgerQueryCalls: [string, unknown][][] = [];
  const rpcCalls: [string, Record<string, unknown>][] = [];

  const from = (table: string) => {
    const filters: [string, unknown][] = [];
    const builder = {
      select: () => builder,
      eq: (col: string, val: unknown) => {
        filters.push([col, val]);
        return builder;
      },
      maybeSingle: () => {
        if (table === 'customers') {
          return Promise.resolve({
            data: customerExists ? { id: CUSTOMER_1 } : null,
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
      single: () => {
        if (table === 'tenants') {
          return Promise.resolve({
            data: { loyalty_scope: loyaltyScope },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
      then: (resolve: (v: { data: unknown[]; error: null }) => void) => {
        if (table === 'loyalty_ledger') {
          ledgerQueryCalls.push([...filters]);
          const tenantFilter = filters.find(([c]) => c === 'tenant_id')?.[1];
          const customerFilter = filters.find(
            ([c]) => c === 'customer_id',
          )?.[1];
          const branchFilter = filters.find(([c]) => c === 'branch_id')?.[1];
          const rows = ledgerRows.filter(
            (r) =>
              r.tenant_id === tenantFilter &&
              r.customer_id === customerFilter &&
              r.branch_id === branchFilter,
          );
          resolve({ data: rows, error: null });
          return;
        }
        resolve({ data: [], error: null });
      },
    };
    return builder;
  };

  const rpc = (name: string, params: Record<string, unknown>) => {
    rpcCalls.push([name, params]);
    return Promise.resolve(rpcResult);
  };

  return {
    supabase: { from, rpc } as unknown as SupabaseClient,
    ledgerQueryCalls,
    rpcCalls,
  };
}

function buildService(fixtures: Fixtures = {}) {
  const { supabase, ledgerQueryCalls, rpcCalls } = fakeSupabase(fixtures);
  const tiersRepo = {} as LoyaltyTiersRepository;
  const tenantSession = {} as TenantSessionService;
  const service = new LoyaltyService(supabase, tiersRepo, tenantSession);
  return { service, ledgerQueryCalls, rpcCalls };
}

describe('LoyaltyService.redeemPoints — SHARED scope', () => {
  it('1. redeem succeeds using the pooled total, never queries loyalty_ledger for a branch balance', async () => {
    const { service, ledgerQueryCalls, rpcCalls } = buildService({
      loyaltyScope: 'shared',
    });

    await service.redeemPoints(TENANT_A, CUSTOMER_1, 15, {
      branchId: BRANCH_B,
    });

    expect(ledgerQueryCalls).toHaveLength(0);
    expect(rpcCalls[0][1]).toMatchObject({ p_delta: -15, p_type: 'redeem' });
  });

  it('2. redeem at any branch is permitted under SHARED — no branch-mismatch rejection', async () => {
    const { service } = buildService({ loyaltyScope: 'shared' });

    await expect(
      service.redeemPoints(TENANT_A, CUSTOMER_1, 15, { branchId: BRANCH_A }),
    ).resolves.toBeUndefined();
  });
});

describe('LoyaltyService.redeemPoints — BRANCH scope', () => {
  it('3. sufficient own-branch balance → redeem allowed', async () => {
    const { service, rpcCalls } = buildService({
      loyaltyScope: 'branch',
      ledgerRows: [
        {
          tenant_id: TENANT_A,
          customer_id: CUSTOMER_1,
          branch_id: BRANCH_B,
          delta: 10,
        },
      ],
    });

    await service.redeemPoints(TENANT_A, CUSTOMER_1, 10, {
      branchId: BRANCH_B,
    });

    expect(rpcCalls).toHaveLength(1);
  });

  it('4. insufficient own-branch balance → rejected even though the pooled total would cover it', async () => {
    const { service, rpcCalls } = buildService({
      loyaltyScope: 'branch',
      ledgerRows: [
        {
          tenant_id: TENANT_A,
          customer_id: CUSTOMER_1,
          branch_id: BRANCH_B,
          delta: 5,
        },
      ],
    });

    await expect(
      service.redeemPoints(TENANT_A, CUSTOMER_1, 10, { branchId: BRANCH_B }),
    ).rejects.toThrow(BadRequestException);
    // The DB function must never even be called once the pre-check fails.
    expect(rpcCalls).toHaveLength(0);
  });

  it('8. redemption at C cannot consume balance earned at B — cross-branch isolation', async () => {
    const { service } = buildService({
      loyaltyScope: 'branch',
      ledgerRows: [
        {
          tenant_id: TENANT_A,
          customer_id: CUSTOMER_1,
          branch_id: BRANCH_A,
          delta: 10,
        },
        // No rows at all for BRANCH_B — 0 balance there.
      ],
    });

    await expect(
      service.redeemPoints(TENANT_A, CUSTOMER_1, 5, { branchId: BRANCH_B }),
    ).rejects.toThrow('Insufficient loyalty points balance');
  });

  it('missing branch context under BRANCH scope → rejected with a clear error, no silent fallback', async () => {
    const { service } = buildService({ loyaltyScope: 'branch' });

    await expect(
      service.redeemPoints(TENANT_A, CUSTOMER_1, 5, {}),
    ).rejects.toThrow('Branch context is required');
  });

  it('branch balance queries are correctly scoped to tenant_id (cross-tenant isolation)', async () => {
    const { service, ledgerQueryCalls } = buildService({
      loyaltyScope: 'branch',
      ledgerRows: [
        {
          tenant_id: TENANT_B,
          customer_id: CUSTOMER_1,
          branch_id: BRANCH_A,
          delta: 100,
        },
      ],
    });

    // Same customer/branch id, but a DIFFERENT tenant's ledger rows must
    // never be visible to this tenant's balance check.
    await expect(
      service.redeemPoints(TENANT_A, CUSTOMER_1, 5, { branchId: BRANCH_A }),
    ).rejects.toThrow('Insufficient loyalty points balance');
    expect(ledgerQueryCalls[0]).toContainEqual(['tenant_id', TENANT_A]);
  });
});

describe('LoyaltyService — fail-closed scope resolution (mirrors Batch 1 Remediation 2)', () => {
  it('malformed/unexpected loyalty_scope value resolves to branch (restrictive), never shared', async () => {
    const { service, rpcCalls } = buildService({
      loyaltyScope: 'garbage-value',
      ledgerRows: [],
    });

    await expect(
      service.redeemPoints(TENANT_A, CUSTOMER_1, 5, { branchId: BRANCH_A }),
    ).rejects.toThrow(BadRequestException);
    expect(rpcCalls).toHaveLength(0);
  });

  it('null loyalty_scope resolves to branch (restrictive), never shared', async () => {
    const { service } = buildService({ loyaltyScope: null, ledgerRows: [] });

    await expect(
      service.redeemPoints(TENANT_A, CUSTOMER_1, 5, { branchId: BRANCH_A }),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('LoyaltyService.awardPoints — context threading', () => {
  it('earn passes branch_id/order_id/created_by straight through to the function', async () => {
    const { service, rpcCalls } = buildService({});

    await service.awardPoints(TENANT_A, CUSTOMER_1, 20, {
      branchId: BRANCH_A,
      orderId: 'order-1',
      createdBy: 'user-1',
    });

    expect(rpcCalls[0]).toEqual([
      'fn_adjust_loyalty_points',
      {
        p_customer_id: CUSTOMER_1,
        p_delta: 20,
        p_type: 'earn',
        p_branch_id: BRANCH_A,
        p_order_id: 'order-1',
        p_created_by: 'user-1',
      },
    ]);
  });
});

describe('LoyaltyService.adjustPoints — manual adjustments', () => {
  it('10a. Central/global adjustment carries branch_id = null', async () => {
    const { service, rpcCalls } = buildService({
      rpcResult: {
        data: [{ loyalty_points: 55, lifetime_points_earned: 55 }],
        error: null,
      },
    });

    const result = await service.adjustPoints(TENANT_A, CUSTOMER_1, 5, {
      createdBy: 'owner-1',
    });

    expect(rpcCalls[0][1]).toMatchObject({
      p_type: 'adjustment',
      p_branch_id: null,
    });
    expect(result).toEqual({ loyalty_points: 55, lifetime_points_earned: 55 });
  });

  it('10b. branch-scoped adjustment carries its branch', async () => {
    const { service, rpcCalls } = buildService({});

    await service.adjustPoints(TENANT_A, CUSTOMER_1, -3, {
      branchId: BRANCH_A,
      createdBy: 'manager-1',
    });

    expect(rpcCalls[0][1]).toMatchObject({
      p_type: 'adjustment',
      p_branch_id: BRANCH_A,
      p_delta: -3,
    });
  });

  it('11. insufficient balance for a negative adjustment → rejected', async () => {
    const { service } = buildService({ rpcResult: { data: [], error: null } });

    await expect(
      service.adjustPoints(TENANT_A, CUSTOMER_1, -1000, {}),
    ).rejects.toThrow(BadRequestException);
  });
});

// Customer Domain Phase 8 (Owner-approved) — the literal test matrix
// required by the batch spec, expressed as running-balance progressions
// (not just branching-logic assertions, which Phase 7's suite above
// already covers). A stateful fake tracks the pooled scalar and the
// ledger exactly like the real fn_adjust_loyalty_points does, so these
// tests prove the arithmetic sequence, not just individual calls.
function statefulFakeSupabase(loyaltyScope: 'shared' | 'branch') {
  let pooled = 0;
  const ledger: { branch_id: string | null; type: string; delta: number }[] =
    [];

  const from = (table: string) => {
    const filters: [string, unknown][] = [];
    const builder = {
      select: () => builder,
      eq: (col: string, val: unknown) => {
        filters.push([col, val]);
        return builder;
      },
      maybeSingle: () =>
        Promise.resolve({
          data: table === 'customers' ? { id: CUSTOMER_1 } : null,
          error: null,
        }),
      single: () =>
        Promise.resolve({
          data: table === 'tenants' ? { loyalty_scope: loyaltyScope } : null,
          error: null,
        }),
      then: (resolve: (v: { data: unknown[]; error: null }) => void) => {
        if (table === 'loyalty_ledger') {
          const branchFilter = filters.find(([c]) => c === 'branch_id')?.[1];
          resolve({
            data: ledger.filter((r) => r.branch_id === branchFilter),
            error: null,
          });
          return;
        }
        resolve({ data: [], error: null });
      },
    };
    return builder;
  };

  const rpc = (_name: string, params: Record<string, unknown>) => {
    const delta = params.p_delta as number;
    if (pooled + delta < 0) return Promise.resolve({ data: [], error: null });
    pooled += delta;
    ledger.push({
      branch_id: (params.p_branch_id as string | null) ?? null,
      type: params.p_type as string,
      delta,
    });
    return Promise.resolve({
      data: [{ loyalty_points: pooled, lifetime_points_earned: pooled }],
      error: null,
    });
  };

  return {
    supabase: { from, rpc } as unknown as SupabaseClient,
    getPooled: () => pooled,
    getLedger: () => ledger,
  };
}

describe('Phase 8 test matrix — Shared Loyalty', () => {
  it('B +10 -> total 10; C +10 -> total 20; redeem 15 at C -> total 5; ledger accurate', async () => {
    const { supabase, getPooled, getLedger } = statefulFakeSupabase('shared');
    const service = new LoyaltyService(
      supabase,
      {} as LoyaltyTiersRepository,
      {} as TenantSessionService,
    );

    await service.awardPoints(TENANT_A, CUSTOMER_1, 10, { branchId: BRANCH_A });
    expect(getPooled()).toBe(10);

    await service.awardPoints(TENANT_A, CUSTOMER_1, 10, { branchId: BRANCH_B });
    expect(getPooled()).toBe(20);

    await service.redeemPoints(TENANT_A, CUSTOMER_1, 15, {
      branchId: BRANCH_B,
    });
    expect(getPooled()).toBe(5);

    expect(getLedger()).toEqual([
      { branch_id: BRANCH_A, type: 'earn', delta: 10 },
      { branch_id: BRANCH_B, type: 'earn', delta: 10 },
      { branch_id: BRANCH_B, type: 'redeem', delta: -15 },
    ]);
  });
});

describe('Phase 8 test matrix — Branch Loyalty', () => {
  it('B +10, C +10 -> independent balances; redeem C -10 -> B stays 10, C becomes 0; cannot redeem B at C', async () => {
    const { supabase, getLedger } = statefulFakeSupabase('branch');
    const service = new LoyaltyService(
      supabase,
      {} as LoyaltyTiersRepository,
      {} as TenantSessionService,
    );

    await service.awardPoints(TENANT_A, CUSTOMER_1, 10, { branchId: BRANCH_A });
    await service.awardPoints(TENANT_A, CUSTOMER_1, 10, { branchId: BRANCH_B });

    await service.redeemPoints(TENANT_A, CUSTOMER_1, 10, {
      branchId: BRANCH_B,
    });

    // B's own balance (10 earned, 0 redeemed at B) must still be fully
    // redeemable at B — proves C's redemption never touched B's ledger.
    await expect(
      service.redeemPoints(TENANT_A, CUSTOMER_1, 10, { branchId: BRANCH_A }),
    ).resolves.toBeUndefined();

    // C is now fully exhausted — cannot redeem anything more there.
    await expect(
      service.redeemPoints(TENANT_A, CUSTOMER_1, 1, { branchId: BRANCH_B }),
    ).rejects.toThrow('Insufficient loyalty points balance');

    expect(getLedger()).toEqual([
      { branch_id: BRANCH_A, type: 'earn', delta: 10 },
      { branch_id: BRANCH_B, type: 'earn', delta: 10 },
      { branch_id: BRANCH_B, type: 'redeem', delta: -10 },
      { branch_id: BRANCH_A, type: 'redeem', delta: -10 },
    ]);
  });
});

describe('Phase 8 — existing default-tenant behavior unaffected', () => {
  it('a tenant left at loyalty_scope=shared (the default) behaves exactly as before this batch', async () => {
    const { supabase, getPooled } = statefulFakeSupabase('shared');
    const service = new LoyaltyService(
      supabase,
      {} as LoyaltyTiersRepository,
      {} as TenantSessionService,
    );

    // No branch/order context at all — exactly how every pre-Batch-2 caller
    // invoked awardPoints/redeemPoints before Phase 6 added the optional
    // context parameter.
    await service.awardPoints(TENANT_A, CUSTOMER_1, 25);
    expect(getPooled()).toBe(25);

    await service.redeemPoints(TENANT_A, CUSTOMER_1, 10);
    expect(getPooled()).toBe(15);
  });
});
