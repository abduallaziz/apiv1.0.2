import { SupabaseClient } from '@supabase/supabase-js';
import { CustomersRepository } from './customers.repository';
import { CustomersService } from './customers.service';
import { TenantContext } from '../../core/tenant/tenant-context';
import { JwtPayload } from '../../shared/types/jwt-payload.type';

// Branch isolation TASK 2: customers/vehicles belong to exactly one branch; lookups by phone/plate are
// branch-scoped; creation stamps the context branch; flag-off behaviour is untouched.

const TENANT = 'tenant-1';
const BRANCH = 'branch-a';

function recorder(result: unknown = { data: null, error: null }) {
  const eqs: Array<[string, unknown]> = [];
  const inserts: Record<string, unknown>[] = [];
  const rpcs: Array<[string, Record<string, unknown>]> = [];
  const chain: Record<string, unknown> = {};
  for (const m of [
    'from',
    'select',
    'is',
    'order',
    'range',
    'in',
    'or',
    'limit',
    'update',
    'gte',
    'lte',
  ]) {
    chain[m] = jest.fn(() => chain);
  }
  chain.eq = jest.fn((c: string, v: unknown) => {
    eqs.push([c, v]);
    return chain;
  });
  chain.insert = jest.fn((p: Record<string, unknown>) => {
    inserts.push(p);
    return chain;
  });
  chain.single = jest.fn(() => Promise.resolve({ data: { id: 'x' }, error: null }));
  chain.maybeSingle = jest.fn(() => Promise.resolve(result));
  chain.returns = jest.fn(() => Promise.resolve({ data: [], error: null }));
  chain.rpc = jest.fn((fn: string, args: Record<string, unknown>) => {
    rpcs.push([fn, args]);
    return Promise.resolve({ data: [], error: null });
  });
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: [], count: 0, error: null }).then(resolve);
  return { supabase: chain as unknown as SupabaseClient, eqs, inserts, rpcs };
}

const isolated = new TenantContext(TENANT, BRANCH, true);
const legacy = new TenantContext(TENANT, null);

describe('CustomersRepository branch isolation', () => {
  it('scopes detail, phone and plate lookups to the branch when isolated', async () => {
    const r = recorder();
    const repo = new CustomersRepository(r.supabase);
    await repo.findById(isolated, 'c1');
    await repo.findByPhoneNormalized(isolated, '551234567');
    await repo.findVehicleByPlate(isolated, 'ABC123');
    const branchEqs = r.eqs.filter(([c]) => c === 'branch_id');
    expect(branchEqs).toHaveLength(3);
    expect(branchEqs.every(([, v]) => v === BRANCH)).toBe(true);
  });

  it('does not filter by branch with isolation off', async () => {
    const r = recorder();
    const repo = new CustomersRepository(r.supabase);
    await repo.findById(legacy, 'c1');
    await repo.findByPhoneNormalized(legacy, '551234567');
    await repo.findVehicleByPlate(legacy, 'ABC123');
    expect(r.eqs.some(([c]) => c === 'branch_id')).toBe(false);
  });

  it('stamps branch_id on create (context branch under isolation, null otherwise)', async () => {
    const a = recorder();
    await new CustomersRepository(a.supabase).create(isolated, {
      full_name: 'X',
    } as never);
    expect(a.inserts[0].branch_id).toBe(BRANCH);
    const b = recorder();
    await new CustomersRepository(b.supabase).create(legacy, {
      full_name: 'X',
    } as never);
    expect(b.inserts[0].branch_id).toBeNull();
  });

  it('passes the branch to the spend-sort and loyalty-total functions only when isolated', async () => {
    const a = recorder();
    const repo = new CustomersRepository(a.supabase);
    await repo.findAll(isolated, undefined, 1, 20, [], undefined, 'total_spent');
    expect(a.rpcs[0][1].p_branch_id).toBe(BRANCH);
    const b = recorder();
    await new CustomersRepository(b.supabase).findAll(
      legacy,
      undefined,
      1,
      20,
      [],
      undefined,
      'total_spent',
    );
    expect('p_branch_id' in b.rpcs[0][1]).toBe(false);
  });
});

describe('CustomersService branch isolation', () => {
  const user = { branch_id: null } as unknown as JwtPayload;

  function build() {
    const repo = {
      findByPhone: jest.fn().mockResolvedValue(null),
      findVehicleByPlate: jest.fn().mockResolvedValue(null),
      countAll: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({ id: 'c1' }),
      upsertRelationship: jest.fn().mockResolvedValue(undefined),
      findById: jest.fn(),
      getCustomerIdentityScope: jest.fn().mockResolvedValue('branch'),
      findRelatedCustomerIds: jest.fn().mockResolvedValue([]),
      findAll: jest.fn().mockResolvedValue({ data: [], total: 0 }),
    };
    const defs = { findAll: jest.fn().mockResolvedValue([]) };
    const tenants = {
      getPosConfig: jest.fn().mockResolvedValue({ name_field_enabled: true }),
    };
    const service = new CustomersService(
      repo as never,
      defs as never,
      tenants as never,
    );
    return { service, repo };
  }

  it('stamps created_branch_id with the context branch and ignores a foreign one in the body', async () => {
    const { service, repo } = build();
    await service.create(isolated, user, {
      full_name: 'Ali',
      phone: '0551234567',
      created_branch_id: 'other-branch',
    } as never);
    expect(repo.create.mock.calls[0][1].created_branch_id).toBe(BRANCH);
  });

  it('lets a central user pick the branch with isolation off (legacy)', async () => {
    const { service, repo } = build();
    await service.create(legacy, user, {
      full_name: 'Ali',
      phone: '0551234567',
      created_branch_id: 'picked',
    } as never);
    expect(repo.create.mock.calls[0][1].created_branch_id).toBe('picked');
  });

  it('a customer of another branch is a 404 for a sale reference (repo returns null)', async () => {
    const { service, repo } = build();
    repo.findById.mockResolvedValue(null);
    await expect(
      service.findByIdUnrestricted(isolated, 'foreign'),
    ).rejects.toThrow('Customer not found');
  });

  it('does not use the relationship/identity-scope restriction under isolation', async () => {
    const { service, repo } = build();
    const restricted = { branch_id: BRANCH } as unknown as JwtPayload;
    await service.findAll(isolated, restricted, {} as never);
    expect(repo.getCustomerIdentityScope).not.toHaveBeenCalled();
    expect(repo.findAll.mock.calls[0][5]).toBeUndefined();
  });
});
