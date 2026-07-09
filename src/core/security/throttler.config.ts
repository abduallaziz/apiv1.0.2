import { ThrottlerModuleOptions } from '@nestjs/throttler';

// Runs alongside the tenant-keyed 'global' throttler below, not instead of it —
// every request is checked against BOTH limits. Without this, an attacker who
// forges/rotates tenant_id values in the JWT payload (TenantThrottlerGuard only
// decodes the token to read the tracker key, it doesn't verify the signature —
// JwtAuthGuard does that separately afterward) gets a fresh 600/min bucket per
// forged tenant_id from the very same IP, effectively unthrottled. Keyed purely
// by req.realIp (set by IpMiddleware for every request), independent of any
// tenant context.
function ipTracker(req: Record<string, unknown>): string {
  return `ip:${(req['realIp'] as string) ?? 'unknown'}`;
}

export const throttlerConfig: ThrottlerModuleOptions = {
  throttlers: [
    {
      // A multi-user dashboard (owner + manager + several cashiers navigating
      // simultaneously, each page firing several parallel queries, plus the
      // dashboard's own background polling) realistically exceeds 300 req/min per
      // tenant — 300 was still hit in production on plain single-user actions
      // (e.g. a Settings save) even after the dashboard's polling intervals were
      // widened, so raising further rather than treating this as fully solved.
      name: 'global',
      ttl: 60000,
      limit: 600,
    },
    {
      // Higher ceiling than the per-tenant limit — a shared office network/CGNAT/VPN
      // can legitimately host several tenants at once, each entitled to their own
      // 600/min. This isn't meant to be hit in normal multi-tenant-per-IP use; it's
      // the backstop against a single IP driving traffic across many tenant_ids.
      name: 'global-ip',
      ttl: 60000,
      limit: 1500,
      getTracker: ipTracker,
    },
    {
      // Tighter limit for authentication endpoints to slow credential stuffing
      name: 'auth',
      ttl: 60000,
      limit: 10,
    },
  ],
};

export const throttlers = throttlerConfig.throttlers;
