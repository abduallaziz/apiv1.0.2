import { TenantContext } from './tenant.context';

/** Minimal shape of a Supabase/PostgREST filter builder (type-agnostic). */
interface EqBuilder<Q> {
  eq(column: string, value: string): Q;
}

/**
 * The branch a repository must scope to: the context branch when the tenant runs with branch
 * isolation, otherwise null (= legacy tenant-wide behaviour, no filter, no stamp).
 * Repositories of branch-owned catalog tables take this as an optional trailing `branchId` parameter.
 */
export function isolatedBranchId(tenant: TenantContext): string | null {
  return tenant.isolated && tenant.branchId ? tenant.branchId : null;
}

/** Adds `.eq(column, branchId)` only when a branch scope is given (isolated tenants). */
export function withBranch<Q extends EqBuilder<Q>>(
  query: Q,
  branchId?: string | null,
  column = 'branch_id',
): Q {
  return branchId ? query.eq(column, branchId) : query;
}

/** Payload fragment stamping branch_id on a write, only under isolation. */
export function branchStamp(
  branchId?: string | null,
): { branch_id: string } | Record<string, never> {
  return branchId ? { branch_id: branchId } : {};
}
