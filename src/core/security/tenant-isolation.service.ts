import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';

export interface TenantIsolation {
  /** tenants.branch_isolation_enabled (per-tenant rollout flag). */
  enabled: boolean;
  /** branches.is_main of the tenant (null if none is flagged yet). */
  mainBranchId: string | null;
}

const TTL_MS = 30_000;

/**
 * Branch isolation settings of a tenant (flag + main branch), cached for a few seconds because the
 * TenantGuard needs it on every request. Fails SAFE: if the columns are not there yet (migration
 * 279 not applied) or the lookup errors, the tenant is treated as not isolated.
 */
@Injectable()
export class TenantIsolationService {
  private readonly logger = new Logger(TenantIsolationService.name);
  private readonly cache = new Map<
    string,
    { at: number; value: TenantIsolation }
  >();
  private readonly branchOk = new Map<string, { at: number; ok: boolean }>();

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async get(tenantId: string): Promise<TenantIsolation> {
    const hit = this.cache.get(tenantId);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

    let value: TenantIsolation = { enabled: false, mainBranchId: null };
    try {
      const { data: tenant, error } = await this.supabase
        .from('tenants')
        .select('branch_isolation_enabled')
        .eq('id', tenantId)
        .maybeSingle<{ branch_isolation_enabled: boolean }>();
      if (error) throw error;
      const enabled = tenant?.branch_isolation_enabled === true;
      let mainBranchId: string | null = null;
      if (enabled) {
        const { data: main, error: mainErr } = await this.supabase
          .from('branches')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('is_main', true)
          .is('deleted_at', null)
          .maybeSingle<{ id: string }>();
        if (mainErr) throw mainErr;
        mainBranchId = main?.id ?? null;
      }
      // Isolation without a main branch cannot resolve a default scope: stay off until one exists.
      value = { enabled: enabled && mainBranchId !== null, mainBranchId };
    } catch (e) {
      this.logger.warn(
        `isolation lookup failed for tenant ${tenantId}: ${e instanceof Error ? e.message : 'unknown'}`,
      );
    }
    this.cache.set(tenantId, { at: Date.now(), value });
    return value;
  }

  /** Is this an active, live branch of the tenant? (cached: the guard asks on every request) */
  async isActiveBranch(tenantId: string, branchId: string): Promise<boolean> {
    const key = `${tenantId}:${branchId}`;
    const hit = this.branchOk.get(key);
    if (hit && Date.now() - hit.at < TTL_MS * 2) return hit.ok;
    const { data } = await this.supabase
      .from('branches')
      .select('id')
      .eq('id', branchId)
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .is('deleted_at', null)
      .maybeSingle<{ id: string }>();
    const ok = !!data;
    this.branchOk.set(key, { at: Date.now(), ok });
    return ok;
  }

  invalidate(tenantId: string): void {
    this.cache.delete(tenantId);
    for (const k of this.branchOk.keys()) {
      if (k.startsWith(`${tenantId}:`)) this.branchOk.delete(k);
    }
  }
}
