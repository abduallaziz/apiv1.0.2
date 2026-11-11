import { ThrottlerStorage } from '@nestjs/throttler';
import Redis from 'ioredis';

interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redis: Redis) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const storageKey = `throttle:${throttlerName}:${key}`;
    const blockKey = `throttle:block:${throttlerName}:${key}`;

    const isBlocked = await this.redis.exists(blockKey);
    if (isBlocked) {
      const blockPttl = await this.redis.pttl(blockKey);
      return {
        totalHits: limit + 1,
        timeToExpire: 0,
        isBlocked: true,
        timeToBlockExpire: Math.max(0, Math.ceil(blockPttl / 1000)),
      };
    }

    const pipeline = this.redis.pipeline();
    pipeline.incr(storageKey);
    pipeline.pttl(storageKey);
    const results = await pipeline.exec();

    const totalHits = (results[0][1] as number) ?? 1;
    let pttl = (results[1][1] as number) ?? -1;

    if (pttl < 0) {
      await this.redis.pexpire(storageKey, ttl);
      pttl = ttl;
    }

    const timeToExpire = Math.max(0, Math.ceil(pttl / 1000));

    if (totalHits > limit && blockDuration > 0) {
      // Inventory #7 / F3 residual (Owner-approved) — `blockDuration` is
      // always in milliseconds here: NestJS's ThrottlerGuard passes
      // `blockDuration ?? ttl`, and `ttl` is configured in ms throughout
      // throttler.config.ts (WINDOW_MS = 60000). `EX` takes seconds, so the
      // intended 60s block was being stored as a 60000-SECOND (~16.7 hour)
      // block — every other call in this file already correctly uses the
      // millisecond APIs (PTTL/PEXPIRE); this was the one outlier. `PX`
      // takes milliseconds, matching blockDuration's actual unit and every
      // other Redis call here — no policy value changes, this only fixes
      // the unit bug uniformly across all four tiers (global/global-ip/
      // auth/session), since they all share this one storage class.
      await this.redis.set(blockKey, '1', 'PX', blockDuration);
      return {
        totalHits,
        timeToExpire,
        isBlocked: true,
        // Seconds, matching the already-blocked branch above (which derives
        // this from PTTL/1000) and the HTTP Retry-After convention the
        // guard forwards this value into verbatim — returning raw
        // millisecond `blockDuration` here would give a Retry-After header
        // 1000x too large, the client-facing symptom of the same bug fixed
        // above.
        timeToBlockExpire: Math.max(0, Math.ceil(blockDuration / 1000)),
      };
    }

    return {
      totalHits,
      timeToExpire,
      isBlocked: false,
      timeToBlockExpire: 0,
    };
  }
}
