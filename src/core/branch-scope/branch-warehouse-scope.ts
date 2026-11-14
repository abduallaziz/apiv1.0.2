import { AsyncLocalStorage } from 'async_hooks';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

/**
 * Branch isolation for everything keyed by a warehouse (inventory, purchasing, WMS, ...).
 * A warehouse belongs to exactly one branch (warehouses.branch_id), so "the branch's data" is
 * "the rows whose warehouse_id is one of the branch's warehouses".
 *
 * The scope is carried per request in AsyncLocalStorage (set by BranchWarehouseScopeInterceptor),
 * so repositories that only receive a tenantId can still scope their queries without changing every
 * service signature. With isolation OFF (the default) there is no store and every helper is a no-op.
 */
export interface BranchWarehouseScope {
  tenantId: string;
  branchId: string;
  /** Warehouse ids of the branch (live rows). Resolved lazily and memoised for the request. */
  warehouseIds(): Promise<string[]>;
}

const storage = new AsyncLocalStorage<BranchWarehouseScope>();

export const NIL_UUID = '00000000-0000-0000-0000-000000000000';

export function runWithBranchScope<T>(
  scope: BranchWarehouseScope | null,
  fn: () => T,
): T {
  return scope ? storage.run(scope, fn) : fn();
}

/** The active scope for this tenant, or undefined when isolation is off / wrong tenant. */
export function currentBranchScope(
  tenantId?: string,
): BranchWarehouseScope | undefined {
  const s = storage.getStore();
  if (!s) return undefined;
  if (tenantId && s.tenantId !== tenantId) return undefined;
  return s;
}

export function currentBranchId(tenantId?: string): string | null {
  return currentBranchScope(tenantId)?.branchId ?? null;
}

interface InBuilder<Q> {
  in(column: string, values: string[]): Q;
}

/** Restricts a query to the isolated branch's warehouses (no-op when isolation is off). */
export async function scopeToBranchWarehouses<Q extends InBuilder<Q>>(
  query: Q,
  tenantId: string,
  column = 'warehouse_id',
): Promise<Q> {
  const scope = currentBranchScope(tenantId);
  if (!scope) return query;
  const ids = await scope.warehouseIds();
  return query.in(column, ids.length ? ids : [NIL_UUID]);
}

/** True when the warehouse is usable from the current context (always true with isolation off). */
export async function warehouseInBranch(
  tenantId: string,
  warehouseId: string | null | undefined,
): Promise<boolean> {
  const scope = currentBranchScope(tenantId);
  if (!scope || !warehouseId) return true;
  return (await scope.warehouseIds()).includes(warehouseId);
}

/** Writes: reject a warehouse that belongs to another branch (isolation on only). */
export async function assertWarehouseInBranch(
  tenantId: string,
  warehouseId: string | null | undefined,
  label = 'warehouse',
): Promise<void> {
  if (!(await warehouseInBranch(tenantId, warehouseId))) {
    throw new ForbiddenException(
      `The ${label} belongs to another branch and cannot be used here`,
    );
  }
}

/** Reads of one record by id: pretend it does not exist when its warehouse is in another branch. */
export async function assertVisibleWarehouse(
  tenantId: string,
  warehouseId: string | null | undefined,
  what = 'Record',
): Promise<void> {
  if (!(await warehouseInBranch(tenantId, warehouseId))) {
    throw new NotFoundException(`${what} not found`);
  }
}

/** True when the branch scope is active for the tenant. */
export function isBranchIsolated(tenantId?: string): boolean {
  return !!currentBranchScope(tenantId);
}
