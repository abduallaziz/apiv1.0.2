/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import { AccountingRepository } from './repositories/accounting.repository';
import { AccountingService } from './accounting.service';
import { ExpenseDepartmentsService } from '../expenses-v2/expense-departments.service';
import { TenantContext } from '../../core/tenant/tenant-context';
import { ForbiddenException } from '@nestjs/common';

// Chainable fake: every builder method returns the builder; awaiting it yields the queued result for the table.
function fake(results: Record<string, unknown>) {
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  const supabase = {
    from: jest.fn((table: string) => {
      const b: any = {};
      for (const m of [
        'select',
        'eq',
        'in',
        'or',
        'order',
        'insert',
        'update',
        'is',
      ])
        b[m] = jest.fn((...args: unknown[]) => {
          calls.push({ table, method: m, args });
          return b;
        });
      b.maybeSingle = jest.fn(() =>
        Promise.resolve({ data: results[table], error: null }),
      );
      b.single = jest.fn(() =>
        Promise.resolve({ data: { id: 'new' }, error: null }),
      );
      b.then = (resolve: (v: unknown) => unknown) =>
        resolve({ data: results[table] ?? [], error: null });
      return b;
    }),
  };
  return { supabase, calls };
}

const legacy = new TenantContext('t1');
const isolatedA = new TenantContext('t1', 'b-a', true);

describe('AccountingRepository.resolveBranchBookIds', () => {
  it('returns null when isolation is off', async () => {
    const { supabase } = fake({});
    const repo = new AccountingRepository(supabase as any);
    expect(await repo.resolveBranchBookIds(legacy)).toBeNull();
  });

  it('restricts a non-main branch to the books of its own owner', async () => {
    const { supabase, calls } = fake({
      branches: { is_main: false },
      accounting_owners: [{ id: 'o1' }],
      accounting_books: [{ id: 'bk1' }],
    });
    const repo = new AccountingRepository(supabase as any);
    expect(await repo.resolveBranchBookIds(isolatedA)).toEqual(['bk1']);
    expect(
      calls.find(
        (c) =>
          c.table === 'accounting_owners' &&
          c.method === 'eq' &&
          c.args[0] === 'branch_id',
      )?.args[1],
    ).toBe('b-a');
  });

  it('adds central (branch-less) owners for the main branch', async () => {
    const { supabase, calls } = fake({
      branches: { is_main: true },
      accounting_owners: [{ id: 'o1' }],
      accounting_books: [{ id: 'bk1' }],
    });
    const repo = new AccountingRepository(supabase as any);
    await repo.resolveBranchBookIds(isolatedA);
    expect(calls.some((c) => c.method === 'or')).toBe(true);
  });

  it('never matches anything when the branch has no books', async () => {
    const { supabase } = fake({
      branches: { is_main: false },
      accounting_owners: [],
    });
    const repo = new AccountingRepository(supabase as any);
    expect(await repo.resolveBranchBookIds(isolatedA)).toEqual([
      '00000000-0000-0000-0000-000000000000',
    ]);
  });
});

describe('AccountingService.assignBranchAccountingOwner', () => {
  it('rejects assigning another branch under isolation', async () => {
    const service = new AccountingService({} as any);
    await expect(
      service.assignBranchAccountingOwner(
        isolatedA,
        { branch_id: 'b-other' } as any,
        'u1',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('ExpenseDepartmentsService branch scoping', () => {
  it('does not filter or stamp the branch when isolation is off', async () => {
    const { supabase, calls } = fake({ expense_departments: [] });
    const svc = new ExpenseDepartmentsService(supabase as any);
    await svc.findAll('t1', false, legacy);
    await svc.create('t1', 'u1', { name: 'X' }, legacy);
    expect(
      calls.some((c) => c.method === 'eq' && c.args[0] === 'branch_id'),
    ).toBe(false);
    const insert = calls.find((c) => c.method === 'insert');
    expect(insert?.args[0]).not.toHaveProperty('branch_id');
  });

  it('filters lists and stamps new rows with the context branch under isolation', async () => {
    const { supabase, calls } = fake({ expense_departments: [] });
    const svc = new ExpenseDepartmentsService(supabase as any);
    await svc.findAll('t1', false, isolatedA);
    expect(
      calls.some(
        (c) =>
          c.method === 'eq' && c.args[0] === 'branch_id' && c.args[1] === 'b-a',
      ),
    ).toBe(true);
    await svc.create('t1', 'u1', { name: 'X' }, isolatedA);
    const insert = calls.find((c) => c.method === 'insert');
    expect(insert?.args[0]).toMatchObject({ branch_id: 'b-a' });
  });
});

describe('AccountingRepository.getCommandCenterSummary paging', () => {
  it('sums lines across pages scoped to the branch books (no 1000-row truncation)', async () => {
    const pages = [
      Array.from({ length: 1000 }, () => ({ credit_amount: 1 })),
      [{ credit_amount: 25 }],
    ];
    let page = 0;
    const repo = new AccountingRepository({} as any);
    const builder: any = {};
    for (const m of ['select', 'eq', 'in', 'order']) builder[m] = () => builder;
    builder.range = jest.fn(() =>
      Promise.resolve({ data: pages[page++] ?? [], error: null }),
    );
    (repo as any).supabase = {
      from: (t: string) =>
        t === 'account_role_assignments'
          ? {
              select: () => ({
                eq: () => ({
                  in: () => Promise.resolve({ data: [{ account_id: 'a1' }] }),
                }),
              }),
            }
          : builder,
    };
    const total = await (repo as any).sumLinesByRole(
      isolatedA,
      'sales_revenue',
      'credit',
      ['bk1'],
    );
    expect(total).toBe(1025);
    expect(builder.range).toHaveBeenCalledTimes(2);
  });
});
