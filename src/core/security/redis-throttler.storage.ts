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
      await this.redis.set(blockKey, '1', 'EX', blockDuration);
      return {
        totalHits,
        timeToExpire,
        isBlocked: true,
        timeToBlockExpire: blockDuration,
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
