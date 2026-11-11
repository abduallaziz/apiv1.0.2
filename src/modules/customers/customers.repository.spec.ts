import { SupabaseClient } from '@supabase/supabase-js';
import { CustomersRepository } from './customers.repository';
import { TenantContext } from '../../core/tenant/tenant-context';

// Customer Domain Phase 3 (Owner-approved) — targeted test for
// upsertRelationship()'s explicit select-then-branch logic. A plain
// Supabase .upsert() would apply the same payload to both the insert and
// update branches, clobbering `source`/`first_seen_at` on every repeat
// call — this test proves the repository avoids that by only ever
// touching `last_seen_at` on an existing row.

const TENANT_ID = 'tenant-a';
const CUSTOMER_ID = 'customer-1';
const BRANCH_ID = 'branch-a';

function fakeSupabase(existingRow: { id: string } | null) {
  const updateCalls: Record<string, unknown>[] = [];
  const insertCalls: Record<string, unknown>[] = [];

  const chain: Record<string, jest.Mock> = {
    from: jest.fn(() => chain),
    select: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    maybeSingle: jest.fn(() =>
      Promise.resolve({ data: existingRow, error: null }),
    ),
    update: jest.fn((payload: Record<string, unknown>) => {
      updateCalls.push(payload);
      return {
        eq: jest.fn(() => Promise.resolve({ error: null })),
      };
    }),
    insert: jest.fn((payload: Record<string, unknown>) => {
      insertCalls.push(payload);
      return Promise.resolve({ error: null });
    }),
  };

  return {
    supabase: chain as unknown as SupabaseClient,
    updateCalls,
    insertCalls,
  };
}

function tenantContext(): TenantContext {
  return new TenantContext(TENANT_ID, null);
}

describe('CustomersRepository.upsertRelationship', () => {
  it('inserts a new row with the given source when no relationship exists yet', async () => {
    const { supabase, insertCalls, updateCalls } = fakeSupabase(null);
    const repo = new CustomersRepository(supabase);

    await repo.upsertRelationship(
      tenantContext(),
      CUSTOMER_ID,
      BRANCH_ID,
      'created',
    );

    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0]).toEqual({
      tenant_id: TENANT_ID,
      customer_id: CUSTOMER_ID,
      branch_id: BRANCH_ID,
      source: 'created',
    });
    expect(updateCalls).toHaveLength(0);
  });

  it('only updates last_seen_at when a relationship already exists — never touches source', async () => {
    const { supabase, insertCalls, updateCalls } = fakeSupabase({
      id: 'existing-rel-id',
    });
    const repo = new CustomersRepository(supabase);

    await repo.upsertRelationship(
      tenantContext(),
      CUSTOMER_ID,
      BRANCH_ID,
      'transaction',
    );

    expect(insertCalls).toHaveLength(0);
    expect(updateCalls).toHaveLength(1);
    expect(Object.keys(updateCalls[0])).toEqual(['last_seen_at']);
  });
});

// Batch 1 Remediation 2 (Owner-approved) — getCustomerIdentityScope() must
// fail toward the restrictive state ('branch'), never the permissive one
// ('shared'), whenever the read result is missing/malformed. Genuine
// infrastructure errors (network/timeout/malformed query) must still
// propagate as exceptions, never be swallowed into either scope value —
// mirrors BranchAuthorizationService.branchExists()'s established
// fail-closed convention for the same class of "authorization-relevant
// lookup failed" situation.
function fakeTenantsSupabase(
  result: { data: unknown; error: unknown } | { throwOn: 'query' },
) {
  const chain: Record<string, jest.Mock> = {
    from: jest.fn(() => chain),
    select: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    single: jest.fn(() => {
      if ('throwOn' in result) {
        return Promise.resolve({
          data: null,
          error: new Error('simulated DB error'),
        });
      }
      return Promise.resolve(result);
    }),
  };
  return chain as unknown as SupabaseClient;
}

describe('CustomersRepository.getCustomerIdentityScope — fail-closed (Batch 1 Remediation 2)', () => {
  it('1. successful shared → returns shared', async () => {
    const repo = new CustomersRepository(
      fakeTenantsSupabase({
        data: { customer_identity_scope: 'shared' },
        error: null,
      }),
    );
    await expect(repo.getCustomerIdentityScope(TENANT_ID)).resolves.toBe(
      'shared',
    );
  });

  it('2. successful branch → returns branch', async () => {
    const repo = new CustomersRepository(
      fakeTenantsSupabase({
        data: { customer_identity_scope: 'branch' },
        error: null,
      }),
    );
    await expect(repo.getCustomerIdentityScope(TENANT_ID)).resolves.toBe(
      'branch',
    );
  });

  it('3. unexpected null/missing scope → returns branch, not shared', async () => {
    const repo = new CustomersRepository(
      fakeTenantsSupabase({
        data: { customer_identity_scope: null },
        error: null,
      }),
    );
    await expect(repo.getCustomerIdentityScope(TENANT_ID)).resolves.toBe(
      'branch',
    );
  });

  it('3b. missing data row entirely → returns branch, not shared', async () => {
    const repo = new CustomersRepository(
      fakeTenantsSupabase({ data: null, error: null }),
    );
    await expect(repo.getCustomerIdentityScope(TENANT_ID)).resolves.toBe(
      'branch',
    );
  });

  it('4. invalid/unexpected scope value → restrictive (branch), not shared/unrestricted', async () => {
    const repo = new CustomersRepository(
      fakeTenantsSupabase({
        data: { customer_identity_scope: 'garbage-value' },
        error: null,
      }),
    );
    await expect(repo.getCustomerIdentityScope(TENANT_ID)).resolves.toBe(
      'branch',
    );
  });

  it('5. DB error → exception propagates, never swallowed into a scope value', async () => {
    const repo = new CustomersRepository(
      fakeTenantsSupabase({ throwOn: 'query' }),
    );
    await expect(repo.getCustomerIdentityScope(TENANT_ID)).rejects.toThrow(
      'simulated DB error',
    );
  });

  it('6. timeout/error → exception propagates, never swallowed', async () => {
    const repo = new CustomersRepository(
      fakeTenantsSupabase({ throwOn: 'query' }),
    );
    await expect(repo.getCustomerIdentityScope(TENANT_ID)).rejects.toThrow();
  });
});
