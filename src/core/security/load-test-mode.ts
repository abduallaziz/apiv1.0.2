import { Logger } from '@nestjs/common';

/**
 * TEMPORARY — rate-limit bypass for load testing. Remove once benchmarking is
 * finished.
 *
 * Why this exists: the throttlers in `throttler.config.ts` cap a tenant at
 * `PER_TENANT_LIMIT` (600) requests per minute, and `EmailLoginThrottleGuard`
 * caps one email at 5 login attempts per minute. Both are correct for real
 * traffic and are deliberately left in place. But they also mean a k6 run
 * against a single tenant saturates its budget within seconds, after which the
 * run measures the throttler's 429 rate instead of the application's own
 * ceiling — which is the opposite of what a load test is for.
 *
 * What this flag does NOT do:
 *   - It does not remove, weaken or rewrite any rate-limiting code. Every
 *     guard, bucket and limit stays exactly as it was; this only adds an
 *     explicit early exit in front of them.
 *   - It does not touch business logic, validation, authentication or
 *     authorization. A request that bypasses throttling still goes through
 *     JwtAuthGuard, TenantGuard and PermissionGuard unchanged.
 *   - It does not change production behaviour. The flag is opt-in and defaults
 *     to off, so an environment that does not set it behaves byte-identically
 *     to before this file existed.
 *
 * Enabling requires the literal string 'true'. Anything else — unset, empty,
 * '1', 'yes', 'TRUE' — leaves throttling fully active. The strictness is
 * deliberate: a typo should fail closed (limits enforced), never open.
 *
 * SECURITY NOTE: while enabled, this removes the brute-force protection on
 * /auth/login. It must only be on in an environment with no real customer
 * data, and only for the duration of a test run.
 */

const logger = new Logger('LoadTestMode');

const ENV_KEY = 'LOAD_TEST_MODE';

/**
 * Read on every call rather than cached at module load, so the flag can be
 * flipped by a redeploy without any stale in-process state, and so tests can
 * exercise both branches without module cache tricks.
 */
export function isLoadTestMode(): boolean {
  return process.env[ENV_KEY] === 'true';
}

/**
 * Logged once at boot from `main.ts`. Loud on purpose: an environment left in
 * this mode by accident has no rate limiting at all, and that must never be
 * something you have to go looking for in a config dashboard to discover.
 */
export function warnIfLoadTestModeEnabled(): void {
  if (!isLoadTestMode()) {
    return;
  }

  const isProduction = process.env.NODE_ENV === 'production';

  logger.warn('='.repeat(72));
  logger.warn('LOAD_TEST_MODE IS ENABLED — RATE LIMITING IS BYPASSED');
  logger.warn('');
  logger.warn('  Disabled for every request while this flag is set:');
  logger.warn('    - per-tenant limit      (600 req/min)');
  logger.warn('    - per-IP limit          (tenants x 600 req/min)');
  logger.warn('    - auth limit            (30 login attempts/min per IP)');
  logger.warn('    - session limit         (60 refresh/logout per min)');
  logger.warn(
    '    - per-email login limit (5 attempts/min) <- brute-force guard',
  );
  logger.warn('');
  logger.warn(
    '  This is a temporary load-testing flag. Unset LOAD_TEST_MODE to',
  );
  logger.warn(
    '  restore every limit. No limit configuration has been changed.',
  );

  if (isProduction) {
    logger.warn('');
    logger.warn('  NODE_ENV=production AND LOAD_TEST_MODE=true.');
    logger.warn('  If this environment serves real users, unset the flag NOW.');
  }

  logger.warn('='.repeat(72));
}
