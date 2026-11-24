import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';
import { LOCK_EXEMPT } from './entitlements.service';

/** tenants.status values that mean "this tenant may not use the app" (CHECK: active|trial|suspended|cancelled). */
export type BlockedTenantStatus = 'suspended' | 'cancelled';

const BLOCKED: readonly string[] = ['suspended', 'cancelled'];

function flagOn(name: string): boolean {
  return (process.env[name] ?? '').trim().toLowerCase() === 'true';
}

/** AUTH_ENFORCE_TENANT_STATUS (Joi boolean, default false). Read per call so the flag is a pure switch. */
export function isTenantStatusEnforced(): boolean {
  return flagOn('AUTH_ENFORCE_TENANT_STATUS');
}

/** AUTH_REVOKE_SESSIONS_ON_PASSWORD_CHANGE (Joi boolean, default false). */
export function isRevokeSessionsOnPasswordChange(): boolean {
  return flagOn('AUTH_REVOKE_SESSIONS_ON_PASSWORD_CHANGE');
}

const BILLING_EXTRA = /(^|\/)(tenant\/(subscription|usage)|payments)(\/|\?|$)/;
const PROFILE_READ = /(^|\/)tenant\/profile(\/|\?|$)/;

/**
 * Routes a suspended/cancelled tenant must still reach (renewal / payment screens and sign-out): everything the
 * subscription lock already exempts (subscriptions, billing, plans, entitlements, auth, health, webhooks) plus
 * the billing page's own reads (/tenant/subscription, /tenant/usage, /payments/*) and GET /tenant/profile.
 */
export function isTenantStatusExempt(path: string, method?: string): boolean {
  if (LOCK_EXEMPT.test(path) || BILLING_EXTRA.test(path)) return true;
  return (method ?? 'GET').toUpperCase() === 'GET' && PROFILE_READ.test(path);
}

export function tenantBlockMessage(status: BlockedTenantStatus): string {
  return status === 'suspended'
    ? 'Your account (tenant) is suspended. Contact support or renew your subscription to regain access.'
    : 'Your account (tenant) has been cancelled. Contact support.';
}

/**
 * Uncached lookup used by login/refresh (rare, so a fresh read is fine). Returns the blocked status or null.
 * Fails OPEN on a lookup error (an outage must not lock every tenant out); a missing row is not blocked.
 */
export async function fetchBlockedTenantStatus(
  supabase: SupabaseClient,
  tenantId: string,
  logger?: Logger,
): Promise<BlockedTenantStatus | null> {
  try {
    const { data, error } = await supabase
      .from('tenants')
      .select('status')
      .eq('id', tenantId)
      .maybeSingle<{ status: string }>();
    if (error) throw error;
    return data && BLOCKED.includes(data.status)
      ? (data.status as BlockedTenantStatus)
      : null;
  } catch (e) {
    logger?.warn(
      `tenant status lookup failed for ${tenantId}: ${e instanceof Error ? e.message : e}`,
    );
    return null;
  }
}

/**
 * Per-request check for the TenantGuard, behind AUTH_ENFORCE_TENANT_STATUS. Cached in memory
 * (AUTH_TENANT_STATUS_CACHE_TTL_SECONDS, default 60) so the hot path does not add a database round trip:
 * a suspension takes effect on already-issued access tokens within at most that TTL (per API instance).
 */
@Injectable()
export class TenantStatusService {
  private readonly logger = new Logger(TenantStatusService.name);
  private readonly cache = new Map<
    string,
    { at: number; value: BlockedTenantStatus | null }
  >();

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  private ttlMs(): number {
    const n = Number(process.env.AUTH_TENANT_STATUS_CACHE_TTL_SECONDS);
    return (Number.isFinite(n) && n >= 0 ? n : 60) * 1000;
  }

  invalidate(tenantId?: string): void {
    if (tenantId) this.cache.delete(tenantId);
    else this.cache.clear();
  }

  async getBlockedStatus(tenantId: string): Promise<BlockedTenantStatus | null> {
    const hit = this.cache.get(tenantId);
    if (hit && Date.now() - hit.at < this.ttlMs()) return hit.value;
    const value = await fetchBlockedTenantStatus(
      this.supabase,
      tenantId,
      this.logger,
    );
    this.cache.set(tenantId, { at: Date.now(), value });
    return value;
  }
}
