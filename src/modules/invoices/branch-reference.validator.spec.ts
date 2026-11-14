import { BadRequestException } from '@nestjs/common';
import { BranchReferenceValidator } from './branch-reference.validator';
import { TenantContext } from '../../core/tenant/tenant.context';

// Minimal chainable PostgREST mock: each from(table) resolves to the rows configured for the table.
function mockSupabase(tables: Record<string, unknown[] | { error: true }>) {
  const from = jest.fn((table: string) => {
    const state = tables[table];
    const q: any = {};
    const result = () =>
      Array.isArray(state) ? { data: state, error: null } : { data: null, error: { message: 'x' } };
    q.select = jest.fn((cols: string) => {
      q._cols = cols;
      return q;
    });
    for (const m of ['eq', 'in', 'ilike', 'is']) q[m] = jest.fn(() => q);
    q.maybeSingle = jest.fn(async () => ({
      data: Array.isArray(state) ? state[0] ?? null : null,
      error: null,
    }));
    q.then = (res: (v: unknown) => unknown) => {
      // legacy fallback: columns without branch_id when the table "lacks" the column
      return Promise.resolve(result()).then(res);
    };
    return q;
  });
  return { from } as never;
}

const ISO = (branch: string) => new TenantContext('t1', branch, true);

describe('BranchReferenceValidator', () => {
  it('is a no-op when the tenant is not isolated', async () => {
    const supabase = mockSupabase({});
    const v = new BranchReferenceValidator(supabase);
    await v.assertSameBranch(new TenantContext('t1'), 'b1', { itemIds: ['i1'] });
    expect((supabase as any).from).not.toHaveBeenCalled();
  });

  it('accepts references of the same branch', async () => {
    const v = new BranchReferenceValidator(
      mockSupabase({
        branches: [{ is_main: false }],
        items: [{ id: 'i1', branch_id: 'b2' }],
        customers: [{ id: 'c1', branch_id: 'b2' }],
      }),
    );
    await expect(
      v.assertSameBranch(ISO('b2'), 'b2', { itemIds: ['i1'], customerId: 'c1' }),
    ).resolves.toBeUndefined();
  });

  it('rejects an item of another branch with 400', async () => {
    const v = new BranchReferenceValidator(
      mockSupabase({
        branches: [{ is_main: false }],
        items: [{ id: 'i1', branch_id: 'b1' }],
      }),
    );
    await expect(v.assertSameBranch(ISO('b2'), 'b2', { itemIds: ['i1'] })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('treats a NULL branch as main-branch legacy ownership', async () => {
    const rows = { items: [{ id: 'i1', branch_id: null }] };
    const main = new BranchReferenceValidator(mockSupabase({ branches: [{ is_main: true }], ...rows }));
    await expect(main.assertSameBranch(ISO('m'), 'm', { itemIds: ['i1'] })).resolves.toBeUndefined();
    const other = new BranchReferenceValidator(mockSupabase({ branches: [{ is_main: false }], ...rows }));
    await expect(other.assertSameBranch(ISO('b2'), 'b2', { itemIds: ['i1'] })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a customer and a coupon of another branch; accepts a central (NULL) worker', async () => {
    const v = new BranchReferenceValidator(
      mockSupabase({
        branches: [{ is_main: false }],
        customers: [{ id: 'c1', branch_id: 'b1' }],
        coupons: [{ id: 'k1', branch_id: 'b1' }],
        users: [{ id: 'u1', branch_id: null }],
      }),
    );
    await expect(v.assertSameBranch(ISO('b2'), 'b2', { customerId: 'c1' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(v.assertSameBranch(ISO('b2'), 'b2', { couponCode: 'SAVE' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(v.assertSameBranch(ISO('b2'), 'b2', { workerIds: ['u1'] })).resolves.toBeUndefined();
  });
});
