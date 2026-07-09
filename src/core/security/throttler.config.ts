import { ExecutionContext } from '@nestjs/common';
import { ThrottlerOptions } from '@nestjs/throttler';
import Redis from 'ioredis';
import { decodeTenantId } from './decode-tenant.util';

// Same 60s window used by every throttler below — kept as one constant so the
// IP-tenant tracking window (see distinctTenantsPerIp) can never drift out of
// sync with the buckets it's meant to size.
const WINDOW_MS = 60000;
const WINDOW_S = WINDOW_MS / 1000;

// A multi-user dashboard (owner + manager + several cashiers navigating
// simultaneously, each page firing several parallel queries, plus the
// dashboard's own background polling) realistically exceeds 300 req/min per
// tenant — 300 was still hit in production on plain single-user actions
// (e.g. a Settings save) even after the dashboard's polling intervals were
// widened, so raising further rather than treating this as fully solved.
export const PER_TENANT_LIMIT = 600;

function ipTracker(req: Record<string, unknown>): string {
  return `ip:${(req['realIp'] as string) ?? 'unknown'}`;
}

/**
 * Counts distinct tenant_ids seen from this IP within the current ~60s window
 * (a request with no tenant_id — unauthenticated/pre-login — is tracked under
 * one shared 'anon' bucket entry, worth one tenant's worth of headroom) and
 * returns count * PER_TENANT_LIMIT as the IP-wide ceiling for this window.
 *
 * Why this exists: a static IP limit is either too tight (a legitimate
 * multi-branch customer behind one NAT'd IP gets throttled even though each
 * branch/tenant is individually well within its own 600/min) or too loose (a
 * static number generous enough for N tenants gives an attacker who forges/
 * rotates tenant_id from one IP — TenantThrottlerGuard only decodes the
 * token, JwtAuthGuard verifies the signature separately afterward — that same
 * N-tenants' worth of headroom to hammer the API under one real tenant).
 * Sizing the ceiling to the *actual* number of distinct tenants observed from
 * that IP removes the guesswork entirely: a real 3-branch customer always
 * gets exactly 3x headroom, and an attacker only gets extra headroom by
 * actually presenting that many distinct tenant_ids — at which point they're
 * bounded by each forged tenant_id's own 600/min 'global' bucket anyway,
 * because the two throttlers run independently and both must pass.
 *
 * TTL is set once per window (first SADD for a given IP) via a plain
 * TTL-check-then-EXPIRE — not atomic against a concurrent first request for
 * the same IP, but the only failure mode of that race is the window
 * occasionally running a few ms longer than 60s, which is harmless.
 */
async function distinctTenantsPerIp(redis: Redis, req: Record<string, unknown>): Promise<number> {
  const ip = (req['realIp'] as string) ?? 'unknown';
  const tenantId = decodeTenantId(req) ?? 'anon';
  const key = `throttle:ip-tenants:${ip}`;

  await redis.sadd(key, tenantId);
  const ttl = await redis.ttl(key);
  if (ttl < 0) {
    await redis.expire(key, WINDOW_S);
  }

  return redis.scard(key);
}

export function createThrottlers(redis: Redis): ThrottlerOptions[] {
  return [
    {
      name: 'global',
      ttl: WINDOW_MS,
      limit: PER_TENANT_LIMIT,
    },
    {
      // Runs alongside 'global' above, not instead of it — every request is
      // checked against BOTH (ThrottlerGuard requires every configured
      // throttler to pass). Keyed purely by IP, sized dynamically to the
      // number of distinct tenants actually seen from that IP this window.
      name: 'global-ip',
      ttl: WINDOW_MS,
      limit: async (context: ExecutionContext) => {
        const req = context.switchToHttp().getRequest();
        const distinctTenants = await distinctTenantsPerIp(redis, req);
        return distinctTenants * PER_TENANT_LIMIT;
      },
      getTracker: ipTracker,
    },
    {
      // Tighter limit for authentication endpoints to slow credential stuffing
      name: 'auth',
      ttl: WINDOW_MS,
      limit: 10,
    },
  ];
}
