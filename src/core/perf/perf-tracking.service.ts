import { Injectable, Inject } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../cache/redis-cache.module';

// Redis key layout:
//   perf:endpoints            — SET of all tracked endpoint keys ("METHOD route")
//   perf:endpoint:<key>       — HASH with count, totalDurationMs, minDurationMs,
//                               maxDurationMs, totalDbQueries, and status:<code> fields
//
// All counters are updated atomically via HINCRBY so cluster-wide aggregation
// is correct across multiple API instances without any in-process state.

const ENDPOINTS_SET = 'perf:endpoints';
const endpointHashKey = (key: string) => `perf:endpoint:${key}`;

// Lua: atomically set a hash field to the minimum of its current and new value.
const SET_MIN_SCRIPT = `
local current = redis.call('HGET', KEYS[1], ARGV[1])
if current == false or tonumber(ARGV[2]) < tonumber(current) then
  redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
end
`;

// Lua: atomically set a hash field to the maximum of its current and new value.
const SET_MAX_SCRIPT = `
local current = redis.call('HGET', KEYS[1], ARGV[1])
if current == false or tonumber(ARGV[2]) > tonumber(current) then
  redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
end
`;

export interface EndpointStatsSnapshot {
  method: string;
  route: string;
  count: number;
  avgDurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
  avgDbQueries: number;
  statusCodes: Record<string, number>;
}

@Injectable()
export class PerfTrackingService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async record(
    method: string,
    route: string,
    durationMs: number,
    dbQueryCount: number,
    statusCode: number,
  ): Promise<void> {
    const key = `${method} ${route}`;
    const hashKey = endpointHashKey(key);

    try {
      const pipeline = this.redis.pipeline();
      pipeline.sadd(ENDPOINTS_SET, key);
      pipeline.hincrby(hashKey, 'count', 1);
      pipeline.hincrby(hashKey, 'totalDurationMs', durationMs);
      pipeline.hincrby(hashKey, 'totalDbQueries', dbQueryCount);
      pipeline.hincrby(hashKey, `status:${statusCode}`, 1);
      await pipeline.exec();

      // Atomic min/max via Lua — two separate evals, still fast (each ~0.1 ms on local Redis)
      await this.redis.eval(SET_MIN_SCRIPT, 1, hashKey, 'minDurationMs', durationMs);
      await this.redis.eval(SET_MAX_SCRIPT, 1, hashKey, 'maxDurationMs', durationMs);
    } catch {
      // Best-effort — perf tracking must never break the request
    }
  }

  async getSnapshot(): Promise<EndpointStatsSnapshot[]> {
    try {
      const keys = await this.redis.smembers(ENDPOINTS_SET);
      if (!keys.length) return [];

      const snapshots = await Promise.all(
        keys.map(async (key) => {
          const hash = await this.redis.hgetall(endpointHashKey(key));
          const [method, ...routeParts] = key.split(' ');
          const count = Number(hash.count ?? 0);
          const totalDurationMs = Number(hash.totalDurationMs ?? 0);
          const totalDbQueries = Number(hash.totalDbQueries ?? 0);

          const statusCodes: Record<string, number> = {};
          for (const [field, val] of Object.entries(hash)) {
            if (field.startsWith('status:')) {
              statusCodes[field.slice(7)] = Number(val);
            }
          }

          return {
            method,
            route: routeParts.join(' '),
            count,
            avgDurationMs: count ? Math.round((totalDurationMs / count) * 100) / 100 : 0,
            minDurationMs: Number(hash.minDurationMs ?? 0),
            maxDurationMs: Number(hash.maxDurationMs ?? 0),
            avgDbQueries: count ? Math.round((totalDbQueries / count) * 100) / 100 : 0,
            statusCodes,
          };
        }),
      );

      return snapshots;
    } catch {
      return [];
    }
  }

  async reset(): Promise<void> {
    try {
      const keys = await this.redis.smembers(ENDPOINTS_SET);
      const hashKeys = keys.map(endpointHashKey);
      if (hashKeys.length) await this.redis.del(...hashKeys);
      await this.redis.del(ENDPOINTS_SET);
    } catch {
      // best-effort
    }
  }
}
