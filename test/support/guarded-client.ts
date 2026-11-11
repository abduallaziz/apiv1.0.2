/**
 * Defence-in-depth wrapper around a supabase-js client used by integration
 * tests. Even inside an allowed (isolated) test project it:
 *  - refuses insert/upsert rows whose tenant_id is not an allowed test tenant;
 *  - refuses rpc calls whose p_tenant_id / tenant_id arg is not allowed;
 *  - refuses update/delete issued without ANY filter (whole-table mutation).
 * Reads are not restricted.
 */

const FILTER_METHODS = new Set([
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in',
  'contains', 'containedBy', 'match', 'not', 'or', 'filter', 'overlaps',
  'rangeGt', 'rangeGte', 'rangeLt', 'rangeLte', 'rangeAdjacent', 'textSearch',
]);

interface Ctx {
  allowed: Set<string>;
  write: 'update' | 'delete' | null;
  filtered: boolean;
}

function checkTenantRows(rows: unknown, allowed: Set<string>, op: string) {
  if (allowed.has('*')) return; // disposable local database: tenant restriction off
  const list = Array.isArray(rows) ? rows : [rows];
  for (const row of list) {
    const t = (row as { tenant_id?: unknown } | null)?.tenant_id;
    if (t !== undefined && t !== null && !allowed.has(String(t))) {
      throw new Error(
        `Test guard: ${op} blocked — tenant_id is not an allowed test tenant`,
      );
    }
  }
}

function wrapBuilder<T extends object>(target: T, ctx: Ctx): T {
  return new Proxy(target, {
    get(t, prop, receiver) {
      const value = Reflect.get(t, prop, t);
      if (typeof value !== 'function') return value;

      return (...args: unknown[]) => {
        const name = String(prop);
        if (name === 'insert' || name === 'upsert') {
          checkTenantRows(args[0], ctx.allowed, name);
        } else if (name === 'update' || name === 'delete') {
          ctx.write = name;
          if (name === 'update') checkTenantRows(args[0], ctx.allowed, name);
        } else if (FILTER_METHODS.has(name)) {
          ctx.filtered = true;
        } else if (name === 'then' && ctx.write && !ctx.filtered) {
          const onRejected = args[1] as ((e: unknown) => unknown) | undefined;
          const err = new Error(
            `Test guard: ${ctx.write} without any filter blocked`,
          );
          return Promise.reject(err).then(undefined, onRejected);
        }
        const res = value.apply(t, args);
        if (res === t) return receiver;
        if (res && typeof res === 'object' && name !== 'then') {
          return wrapBuilder(res as object, ctx);
        }
        return res;
      };
    },
  });
}

export function guardClient<C extends object>(
  client: C,
  allowedTenantIds: string[],
): C {
  const allowed = new Set(allowedTenantIds);
  return new Proxy(client, {
    get(t, prop) {
      const value = Reflect.get(t, prop, t);
      if (prop === 'from' && typeof value === 'function') {
        return (...a: unknown[]) =>
          wrapBuilder(value.apply(t, a) as object, {
            allowed,
            write: null,
            filtered: false,
          });
      }
      if (prop === 'rpc' && typeof value === 'function') {
        return (fn: string, args?: Record<string, unknown>, ...rest: unknown[]) => {
          if (allowed.has('*')) return value.call(t, fn, args, ...rest);
          for (const k of ['p_tenant_id', 'tenant_id']) {
            const v = args?.[k];
            if (v !== undefined && v !== null && !allowed.has(String(v))) {
              throw new Error(
                `Test guard: rpc ${fn} blocked — ${k} is not an allowed test tenant`,
              );
            }
          }
          return value.call(t, fn, args, ...rest);
        };
      }
      return typeof value === 'function' ? value.bind(t) : value;
    },
  });
}
