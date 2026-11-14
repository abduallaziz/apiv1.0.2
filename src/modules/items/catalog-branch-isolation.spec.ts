import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ItemsService } from './items.service';
import { CategoriesService } from './categories.service';
import { ItemBarcodesService } from './item-barcodes.service';
import { CouponsService } from '../coupons/coupons.service';
import { CouponsRepository } from '../coupons/coupons.repository';
import { NotePresetsRepository } from '../note-presets/note-presets.repository';
import { isolatedBranchId } from '../../core/tenant/branch-scope-id.util';
import { TenantContext } from '../../core/tenant/tenant.context';

const BRANCH_A = 'branch-a';
const BRANCH_B = 'branch-b';

/** Records every filter applied to a PostgREST-like chain; awaiting it yields `result`. */
function fakeBuilder(result: unknown = { data: [], error: null }) {
  const calls: Array<[string, unknown[]]> = [];
  const proxy: any = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === 'then') {
          return (res: (v: unknown) => unknown) => res(result);
        }
        return (...args: unknown[]) => {
          calls.push([prop, args]);
          return proxy;
        };
      },
    },
  );
  return { proxy, calls };
}
const hasEq = (calls: Array<[string, unknown[]]>, col: string, val: unknown) =>
  calls.some(([m, a]) => m === 'eq' && a[0] === col && a[1] === val);

describe('isolatedBranchId', () => {
  it('is null when the tenant is not isolated (legacy)', () => {
    expect(
      isolatedBranchId(new TenantContext('t', BRANCH_A, false)),
    ).toBeNull();
  });
  it('is the context branch when isolated', () => {
    expect(isolatedBranchId(new TenantContext('t', BRANCH_A, true))).toBe(
      BRANCH_A,
    );
  });
});

describe('ItemsService branch isolation', () => {
  const repo = {
    findAll: jest.fn().mockResolvedValue({ data: [], total: 0 }),
    findById: jest.fn(),
    create: jest.fn((_t: unknown, p: object, _b?: unknown) =>
      Promise.resolve({ id: 'i1', ...p }),
    ),
    nextSkuSequence: jest.fn().mockResolvedValue(7),
    categoryInScope: jest.fn(),
    sumStockForItems: jest.fn().mockResolvedValue(new Map()),
  };
  const cache = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn(),
    delByPrefix: jest.fn(),
  };
  const barcodes = { generateForItem: jest.fn().mockResolvedValue(undefined) };
  const svc = new ItemsService(
    repo as never,
    cache as never,
    barcodes as never,
  );
  beforeEach(() => jest.clearAllMocks());

  it('list cache key includes the branch (isolated) or "all" (legacy)', async () => {
    await svc.findAll('t1', { page: 1, per_page: 10 } as never, BRANCH_A);
    await svc.findAll('t1', { page: 1, per_page: 10 } as never, null);
    const keys = cache.set.mock.calls.map((c) => c[0] as string);
    expect(keys[0]).toContain(`:branch:${BRANCH_A}:`);
    expect(keys[1]).toContain(':branch:all:');
    expect(repo.findAll.mock.calls[0][3]).toBe(BRANCH_A);
  });

  it('create stamps the branch, uses the per-branch SKU counter and barcode', async () => {
    repo.categoryInScope.mockResolvedValue(true);
    await svc.create(
      't1',
      { name: 'x', type: 'product', operation_type: 'sell', price: 1 } as never,
      BRANCH_A,
    );
    expect(repo.nextSkuSequence).toHaveBeenCalledWith('t1', BRANCH_A);
    expect(repo.create.mock.calls[0][2]).toBe(BRANCH_A);
    expect(barcodes.generateForItem).toHaveBeenCalledWith(
      't1',
      'i1',
      null,
      BRANCH_A,
    );
  });

  it('create without isolation passes no branch (flag-off behaviour unchanged)', async () => {
    await svc.create('t1', {
      name: 'x',
      type: 'product',
      operation_type: 'sell',
      price: 1,
    } as never);
    expect(repo.nextSkuSequence).toHaveBeenCalledWith('t1', undefined);
    expect(repo.create.mock.calls[0][2]).toBeUndefined();
  });

  it('rejects a category of another branch', async () => {
    repo.categoryInScope.mockResolvedValue(false);
    await expect(
      svc.create(
        't1',
        {
          name: 'x',
          type: 'product',
          operation_type: 'sell',
          price: 1,
          category_id: 'cat-of-b',
        } as never,
        BRANCH_A,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('detail of another branch item is 404 (repo scoped by branch returns null)', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(svc.findById('i-b', 't1', BRANCH_A)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(repo.findById).toHaveBeenCalledWith('i-b', 't1', BRANCH_A);
  });
});

describe('CategoriesService branch isolation', () => {
  it('create is stamped with the branch; other-branch detail is 404', async () => {
    const repo = {
      create: jest.fn().mockResolvedValue({}),
      findById: jest.fn().mockResolvedValue(null),
    };
    const svc = new CategoriesService(repo as never);
    await svc.create('t1', { name: 'c' } as never, BRANCH_A);
    expect(repo.create).toHaveBeenCalledWith('t1', { name: 'c' }, BRANCH_A);
    await expect(svc.findById('c1', 't1', BRANCH_B)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(repo.findById).toHaveBeenCalledWith('c1', 't1', BRANCH_B);
  });
});

describe('ItemBarcodesService branch isolation', () => {
  it('rejects a barcode for an item of another branch and stamps own-branch ones', async () => {
    const itemsRepo = { findById: jest.fn(), findVariants: jest.fn() };
    const barcodesRepo = { create: jest.fn().mockResolvedValue({}) };
    const svc = new ItemBarcodesService(
      barcodesRepo as never,
      itemsRepo as never,
      {} as never,
    );
    itemsRepo.findById.mockResolvedValue(null);
    await expect(
      svc.create('t1', { item_id: 'i-b', barcode: '1' } as never, BRANCH_A),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(barcodesRepo.create).not.toHaveBeenCalled();

    itemsRepo.findById.mockResolvedValue({ id: 'i-a' });
    await svc.create('t1', { item_id: 'i-a', barcode: '1' } as never, BRANCH_A);
    expect(barcodesRepo.create.mock.calls[0][2]).toBe(BRANCH_A);
  });
});

describe('CouponsService checkout validation by branch', () => {
  const repo = { findByCode: jest.fn() };
  const svc = new CouponsService(repo as never, {} as never);
  beforeEach(() => jest.clearAllMocks());

  it('isolated: looks the code up in the order branch only', async () => {
    repo.findByCode.mockResolvedValue(null);
    const isolated = new TenantContext('t1', BRANCH_A, true);
    await expect(svc.validate(isolated, 'X', 10)).rejects.toThrow(
      'Invalid coupon code',
    );
    expect(repo.findByCode).toHaveBeenCalledWith(isolated, 'X', BRANCH_A);
    await expect(svc.validate(isolated, 'X', 10, BRANCH_B)).rejects.toThrow();
    expect(repo.findByCode).toHaveBeenLastCalledWith(isolated, 'X', BRANCH_B);
  });

  it('flag off: no branch filter', async () => {
    repo.findByCode.mockResolvedValue(null);
    const legacy = new TenantContext('t1', BRANCH_A, false);
    await expect(svc.validate(legacy, 'X', 10)).rejects.toThrow();
    expect(repo.findByCode).toHaveBeenCalledWith(legacy, 'X', null);
  });
});

describe('repositories scope reads/writes by branch only when isolated', () => {
  function supabaseWith(builder: any) {
    return { from: jest.fn(() => builder) } as never;
  }

  it('CouponsRepository.findAll/findByCode filter branch_id when isolated, not otherwise', async () => {
    const iso = new TenantContext('t1', BRANCH_A, true);
    const legacy = new TenantContext('t1', null, false);
    let b = fakeBuilder();
    let repo = new CouponsRepository(supabaseWith(b.proxy));
    await repo.findAll(iso);
    expect(hasEq(b.calls, 'branch_id', BRANCH_A)).toBe(true);

    b = fakeBuilder();
    repo = new CouponsRepository(supabaseWith(b.proxy));
    await repo.findByCode(iso, 'abc'); // request branch
    expect(hasEq(b.calls, 'branch_id', BRANCH_A)).toBe(true);

    b = fakeBuilder();
    repo = new CouponsRepository(supabaseWith(b.proxy));
    await repo.findByCode(iso, 'abc', BRANCH_B); // order branch wins
    expect(hasEq(b.calls, 'branch_id', BRANCH_B)).toBe(true);
    expect(hasEq(b.calls, 'branch_id', BRANCH_A)).toBe(false);

    b = fakeBuilder();
    repo = new CouponsRepository(supabaseWith(b.proxy));
    await repo.findAll(legacy);
    expect(b.calls.some(([m, a]) => m === 'eq' && a[0] === 'branch_id')).toBe(
      false,
    );
  });

  it('CouponsRepository.create stamps branch_id only when isolated', async () => {
    const b = fakeBuilder({ data: {}, error: null });
    const repo = new CouponsRepository(supabaseWith(b.proxy));
    await repo.create(new TenantContext('t1', BRANCH_A, true), {
      code: 'A',
    } as never);
    const insert = b.calls.find(([m]) => m === 'insert')![1][0] as any;
    expect(insert.branch_id).toBe(BRANCH_A);

    const b2 = fakeBuilder({ data: {}, error: null });
    const repo2 = new CouponsRepository(supabaseWith(b2.proxy));
    await repo2.create(new TenantContext('t1', null, false), {
      code: 'A',
    } as never);
    const insert2 = b2.calls.find(([m]) => m === 'insert')![1][0] as any;
    expect('branch_id' in insert2).toBe(false);
  });

  it('NotePresetsRepository scopes the list and stamps creates under isolation', async () => {
    const iso = new TenantContext('t1', BRANCH_A, true);
    const b = fakeBuilder({ data: [], error: null });
    const repo = new NotePresetsRepository(supabaseWith(b.proxy));
    await repo.findActive(iso);
    expect(hasEq(b.calls, 'branch_id', BRANCH_A)).toBe(true);
    const b2 = fakeBuilder({ data: {}, error: null });
    const repo2 = new NotePresetsRepository(supabaseWith(b2.proxy));
    await repo2.create(iso, { text: 'x', sort_order: 0 } as never);
    expect(
      (b2.calls.find(([m]) => m === 'insert')![1][0] as any).branch_id,
    ).toBe(BRANCH_A);
  });
});
