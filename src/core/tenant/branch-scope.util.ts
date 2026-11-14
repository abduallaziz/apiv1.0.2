import { TenantContext } from './tenant.context';

/** Minimal shape of a Supabase/PostgREST filter builder (so this helper stays type-agnostic). */
interface EqBuilder<Q> {
  eq(column: string, value: string): Q;
}

/**
 * Restricts a query to the request's branch when the tenant runs with branch isolation.
 * With isolation off (the default) the query is returned untouched, so adopting this helper in a
 * repository changes nothing until the tenant's flag is turned on.
 */
export function scopeToBranch<Q extends EqBuilder<Q>>(
  query: Q,
  tenant: TenantContext,
  column = 'branch_id',
): Q {
  return tenant.isolated && tenant.branchId
    ? query.eq(column, tenant.branchId)
    : query;
}

/** The branch a new record must be stamped with: the context branch under isolation, else the given fallback. */
export function branchForWrite(
  tenant: TenantContext,
  fallback: string | null = null,
): string | null {
  return tenant.isolated ? tenant.branchId : fallback;
}
