import { RedisThrottlerStorage } from './redis-throttler.storage';

// Inventory #7 / F3 residual (Owner-approved) — regression guard for the
// EX-vs-PX unit bug: `SET blockKey 1 EX blockDuration` treated a
// millisecond blockDuration as seconds, turning an intended 60s block into
// a ~16.7 hour one (60000 "seconds"). A fake ioredis client records exactly
// which command/unit was issued so this can never silently regress back to
// EX with a millisecond value.
function makeFakeRedis() {
  const store = new Map<string, { value: string; expiresAtMs: number | null }>();
  const setCalls: { key: string; unit: string; duration: number }[] = [];

  return {
    setCalls,
    store,
    async exists(key: string) {
      const entry = store.get(key);
      if (!entry) return 0;
      if (entry.expiresAtMs !== null && entry.expiresAtMs <= Date.now()) {
        store.delete(key);
        return 0;
      }
      return 1;
    },
    async pttl(key: string) {
      const entry = store.get(key);
      if (!entry || entry.expiresAtMs === null) return -1;
      return Math.max(0, entry.expiresAtMs - Date.now());
    },
    async set(key: string, value: string, unit: 'EX' | 'PX', duration: number) {
      setCalls.push({ key, unit, duration });
      const ms = unit === 'EX' ? duration * 1000 : duration;
      store.set(key, { value, expiresAtMs: Date.now() + ms });
      return 'OK';
    },
    async pexpire(key: string, ms: number) {
      const entry = store.get(key) ?? { value: '1', expiresAtMs: null };
      entry.expiresAtMs = Date.now() + ms;
      store.set(key, entry);
      return 1;
    },
    pipeline() {
      const ops: (() => Promise<[null, unknown]>)[] = [];
      const self = this as unknown as { store: typeof store };
      return {
        incr(key: string) {
          ops.push(async () => {
            const entry = self.store.get(key) ?? { value: '0', expiresAtMs: null };
            const next = String(Number(entry.value) + 1);
            self.store.set(key, { ...entry, value: next });
            return [null, Number(next)];
          });
          return this;
        },
        pttl(key: string) {
          ops.push(async () => {
            const entry = self.store.get(key);
            if (!entry || entry.expiresAtMs === null) return [null, -1];
            return [null, Math.max(0, entry.expiresAtMs - Date.now())];
          });
          return this;
        },
        async exec() {
          return Promise.all(ops.map((op) => op()));
        },
      };
    },
  };
}

describe('RedisThrottlerStorage (Inventory #7 / F3 residual)', () => {
  it('uses PX (milliseconds), never EX (seconds), to set a block — the exact unit bug that caused a 16.7-hour block instead of 60 seconds', async () => {
    const redis = makeFakeRedis();
    const storage = new RedisThrottlerStorage(redis as any);

    // First call establishes the counter; blow past `limit` on the 2nd call
    // to trigger the block branch.
    await storage.increment('k', 60000, 1, 60000, 'auth');
    const result = await storage.increment('k', 60000, 1, 60000, 'auth');

    expect(result.isBlocked).toBe(true);
    expect(redis.setCalls).toHaveLength(1);
    expect(redis.setCalls[0].unit).toBe('PX');
    expect(redis.setCalls[0].duration).toBe(60000); // milliseconds, as passed in
  });

  it('the stored block key actually expires around blockDuration ms later, not 1000x later', async () => {
    const redis = makeFakeRedis();
    const storage = new RedisThrottlerStorage(redis as any);

    await storage.increment('k2', 60000, 1, 60000, 'global-ip');
    await storage.increment('k2', 60000, 1, 60000, 'global-ip');

    const entry = redis.store.get('throttle:block:global-ip:k2');
    expect(entry).toBeDefined();
    const remainingMs = entry!.expiresAtMs! - Date.now();
    // Should be ~60000ms (60s), not ~60,000,000ms (~16.7 hours, the pre-fix bug).
    expect(remainingMs).toBeGreaterThan(55000);
    expect(remainingMs).toBeLessThan(65000);
  });

  it('timeToBlockExpire is reported in seconds on both the fresh-block path and the already-blocked path, matching the Retry-After header convention', async () => {
    const redis = makeFakeRedis();
    const storage = new RedisThrottlerStorage(redis as any);

    await storage.increment('k3', 60000, 1, 60000, 'session');
    const freshBlock = await storage.increment('k3', 60000, 1, 60000, 'session');
    expect(freshBlock.timeToBlockExpire).toBe(60); // seconds, not 60000ms

    const alreadyBlocked = await storage.increment('k3', 60000, 1, 60000, 'session');
    expect(alreadyBlocked.isBlocked).toBe(true);
    expect(alreadyBlocked.timeToBlockExpire).toBeGreaterThan(0);
    expect(alreadyBlocked.timeToBlockExpire).toBeLessThanOrEqual(60);
  });
});
