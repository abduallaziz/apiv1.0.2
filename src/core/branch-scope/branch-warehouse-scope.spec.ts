import {
  NIL_UUID,
  assertVisibleWarehouse,
  assertWarehouseInBranch,
  branchOrWarehouseFilter,
  branchWarehouseIds,
  effectiveWarehouseId,
  inWarehouses,
  runWithBranchScope,
  scopedRpcPage,
} from './branch-warehouse-scope';
import { BranchWarehouseScopeInterceptor } from './branch-warehouse-scope.interceptor';
import { of, lastValueFrom } from 'rxjs';

const T = 'tenant-1';
const mkScope = (ids: string[], tenantId = T) => ({
  tenantId,
  branchId: 'branch-A',
  warehouseIds: () => Promise.resolve(ids),
});

describe('branch warehouse scope', () => {
  it('is a no-op without an isolated scope (flag off)', async () => {
    expect(await branchWarehouseIds(T)).toBeNull();
    const q = { in: jest.fn() };
    expect(inWarehouses(q as any, null)).toBe(q);
    expect(q.in).not.toHaveBeenCalled();
    await expect(assertWarehouseInBranch(T, 'w-x')).resolves.toBeUndefined();
    expect(await effectiveWarehouseId(T, undefined)).toBeNull();
    expect(await effectiveWarehouseId(T, 'w1')).toBe('w1');
    expect(await branchOrWarehouseFilter(T)).toBeNull();
    expect(await scopedRpcPage(T, 'warehouse_id', 10, 0, jest.fn())).toBeNull();
  });

  it('scopes to the branch warehouses when isolated', async () => {
    await runWithBranchScope(mkScope(['w1', 'w2']), async () => {
      expect(await branchWarehouseIds(T)).toEqual(['w1', 'w2']);
      const q = { in: jest.fn().mockReturnValue('scoped') };
      expect(inWarehouses(q as any, await branchWarehouseIds(T))).toBe(
        'scoped',
      );
      expect(q.in).toHaveBeenCalledWith('warehouse_id', ['w1', 'w2']);
      await expect(assertWarehouseInBranch(T, 'w1')).resolves.toBeUndefined();
      await expect(assertWarehouseInBranch(T, 'w9')).rejects.toThrow(
        /another branch/,
      );
      await expect(assertVisibleWarehouse(T, 'w9')).rejects.toThrow(
        /not found/,
      );
      expect(await branchOrWarehouseFilter(T)).toBe(
        'branch_id.eq.branch-A,warehouse_id.in.(w1,w2)',
      );
    });
  });

  it('uses a nil uuid when the branch owns no warehouse (returns nothing, never everything)', async () => {
    await runWithBranchScope(mkScope([]), async () => {
      expect(await branchWarehouseIds(T)).toEqual([NIL_UUID]);
    });
  });

  it('ignores a scope of another tenant', async () => {
    await runWithBranchScope(mkScope(['w1'], 'other'), async () => {
      expect(await branchWarehouseIds(T)).toBeNull();
    });
  });

  it('effectiveWarehouseId rejects foreign warehouses and defaults a single one', async () => {
    await runWithBranchScope(mkScope(['w1']), async () => {
      expect(await effectiveWarehouseId(T, undefined)).toBe('w1');
      await expect(effectiveWarehouseId(T, 'w2')).rejects.toThrow();
    });
    await runWithBranchScope(mkScope(['w1', 'w2']), async () => {
      expect(await effectiveWarehouseId(T, undefined)).toBeNull();
    });
  });

  it('scopedRpcPage filters foreign rows and paginates in memory', async () => {
    await runWithBranchScope(mkScope(['w1']), async () => {
      const rows = [
        { id: 1, warehouse_id: 'w1' },
        { id: 2, warehouse_id: 'w9' },
        { id: 3, warehouse_id: 'w1' },
      ];
      const res = await scopedRpcPage(T, 'warehouse_id', 1, 1, () =>
        Promise.resolve({ data: rows, error: null }),
      );
      expect(res).toEqual({ rows: [{ id: 3, warehouse_id: 'w1' }], total: 2 });
    });
  });
});

describe('BranchWarehouseScopeInterceptor', () => {
  const ctx = (tenantContext: unknown) =>
    ({
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => ({ tenantContext }) }),
    }) as any;

  it('does not set a scope for non-isolated tenants', async () => {
    const supabase = {} as any;
    const i = new BranchWarehouseScopeInterceptor(supabase);
    let seen: string[] | null = ['unset'];
    await lastValueFrom(
      i.intercept(ctx({ tenantId: T, branchId: 'b', isolated: false }), {
        handle: () => {
          void branchWarehouseIds(T).then((v) => (seen = v));
          return of(1);
        },
      }),
    );
    await new Promise((r) => setImmediate(r));
    expect(seen).toBeNull();
  });

  it('publishes the branch warehouses for isolated tenants', async () => {
    const eq2 = jest.fn().mockReturnValue({
      is: jest.fn().mockResolvedValue({ data: [{ id: 'wA' }], error: null }),
    });
    const supabase = {
      from: () => ({ select: () => ({ eq: () => ({ eq: eq2 }) }) }),
    } as any;
    const i = new BranchWarehouseScopeInterceptor(supabase);
    let seen: string[] | null = null;
    await lastValueFrom(
      i.intercept(ctx({ tenantId: T, branchId: 'branch-X', isolated: true }), {
        handle: () => {
          void branchWarehouseIds(T).then((v) => (seen = v));
          return of(1);
        },
      }),
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(seen).toEqual(['wA']);
    expect(eq2).toHaveBeenCalledWith('branch_id', 'branch-X');
  });
});
