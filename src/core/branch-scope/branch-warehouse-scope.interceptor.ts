import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { Observable } from 'rxjs';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';
import {
  BranchWarehouseScope,
  runWithBranchScope,
} from './branch-warehouse-scope';

const CACHE_TTL_MS = 15_000;
const cache = new Map<string, { at: number; ids: string[] }>();

/** Test/ops hook: forget cached warehouse sets (e.g. after a warehouse is created). */
export function clearBranchWarehouseCache(): void {
  cache.clear();
}

/**
 * Publishes the isolated branch of the request (TenantContext.isolated/branchId, resolved by
 * TenantGuard) to repositories through AsyncLocalStorage. Does nothing for non-isolated tenants.
 */
@Injectable()
export class BranchWarehouseScopeInterceptor implements NestInterceptor {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest();
    const tenant = req?.tenantContext;
    if (!tenant?.isolated || !tenant.branchId || !tenant.tenantId) {
      return next.handle();
    }
    const scope = this.buildScope(tenant.tenantId, tenant.branchId);
    return new Observable((subscriber) =>
      runWithBranchScope(scope, () => {
        const sub = next.handle().subscribe(subscriber);
        return () => sub.unsubscribe();
      }),
    );
  }

  buildScope(tenantId: string, branchId: string): BranchWarehouseScope {
    let memo: Promise<string[]> | null = null;
    return {
      tenantId,
      branchId,
      warehouseIds: () => {
        if (memo === null) memo = this.load(tenantId, branchId);
        return memo;
      },
    };
  }

  private async load(tenantId: string, branchId: string): Promise<string[]> {
    const key = `${tenantId}:${branchId}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.ids;
    const { data, error } = await this.supabase
      .from('warehouses')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('branch_id', branchId)
      .is('deleted_at', null);
    if (error) throw error;
    const ids = (data ?? []).map((r: { id: string }) => r.id);
    cache.set(key, { at: Date.now(), ids });
    return ids;
  }
}
