import { Injectable, Inject } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../cache/redis-cache.module';
import { LoggerService } from '../logger/logger.service';

// Redis key layout:
//   ai_usage:tenants                        — SET of all tracked tenant keys
//   ai_usage:tenant:<tenantId>:jobs         — SET of all job types seen for tenant
//   ai_usage:tenant:<tenantId>:job:<type>   — HASH: count, totalDurationMs,
//                                              totalEstimatedInputTokens,
//                                              totalEstimatedOutputTokens, failCount

const TENANTS_SET = 'ai_usage:tenants';
const tenantJobsSet = (tenantId: string) => `ai_usage:tenant:${tenantId}:jobs`;
const jobHashKey = (tenantId: string, jobType: string) =>
  `ai_usage:tenant:${tenantId}:job:${jobType}`;

export interface AiJobStartEvent {
  jobId: string;
  jobType: string;
  tenantId: string;
  userId?: string;
  /** Estimated input token count — populated when known before the call. */
  estimatedInputTokens?: number;
}

export interface AiJobCompleteEvent {
  jobId: string;
  jobType: string;
  tenantId: string;
  userId?: string;
  durationMs: number;
  /** Actual or estimated input tokens consumed by the LLM call. */
  inputTokens?: number;
  /** Actual or estimated output tokens produced by the LLM call. */
  outputTokens?: number;
}

export interface AiJobFailEvent {
  jobId: string;
  jobType: string;
  tenantId: string;
  userId?: string;
  durationMs: number;
  errorMessage: string;
}

export interface AiUsageSnapshot {
  tenantId: string;
  jobType: string;
  count: number;
  failCount: number;
  avgDurationMs: number;
  totalEstimatedInputTokens: number;
  totalEstimatedOutputTokens: number;
}

@Injectable()
export class AiUsageTrackingService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly logger: LoggerService,
  ) {}

  /** Called by AiProcessor immediately before the job handler runs. */
  trackStart(event: AiJobStartEvent): void {
    this.logger.info('ai.job.start', {
      module: 'ai-usage',
      action: 'job_start',
      tenantId: event.tenantId,
      userId: event.userId,
      meta: {
        jobId: event.jobId,
        jobType: event.jobType,
        estimatedInputTokens: event.estimatedInputTokens ?? null,
      },
    });
  }

  /** Called by AiProcessor after the job handler returns successfully. */
  trackComplete(event: AiJobCompleteEvent): void {
    this.logger.info('ai.job.complete', {
      module: 'ai-usage',
      action: 'job_complete',
      tenantId: event.tenantId,
      userId: event.userId,
      meta: {
        jobId: event.jobId,
        jobType: event.jobType,
        durationMs: event.durationMs,
        inputTokens: event.inputTokens ?? null,
        outputTokens: event.outputTokens ?? null,
        totalTokens:
          event.inputTokens != null && event.outputTokens != null
            ? event.inputTokens + event.outputTokens
            : null,
      },
    });

    // Fire-and-forget — must not block the job completion path
    void this.recordToRedis(event);
  }

  /** Called by AiProcessor when the job throws. */
  trackFail(event: AiJobFailEvent): void {
    this.logger.warn('ai.job.fail', {
      module: 'ai-usage',
      action: 'job_fail',
      tenantId: event.tenantId,
      userId: event.userId,
      meta: {
        jobId: event.jobId,
        jobType: event.jobType,
        durationMs: event.durationMs,
        errorMessage: event.errorMessage,
      },
    });

    void this.recordFailToRedis(event);
  }

  async getSnapshot(tenantId?: string): Promise<AiUsageSnapshot[]> {
    try {
      const tenantIds = tenantId
        ? [tenantId]
        : await this.redis.smembers(TENANTS_SET);

      if (!tenantIds.length) return [];

      const snapshots: AiUsageSnapshot[] = [];

      for (const tid of tenantIds) {
        const jobTypes = await this.redis.smembers(tenantJobsSet(tid));
        for (const jobType of jobTypes) {
          const hash = await this.redis.hgetall(jobHashKey(tid, jobType));
          const count = Number(hash.count ?? 0);
          const totalDurationMs = Number(hash.totalDurationMs ?? 0);
          snapshots.push({
            tenantId: tid,
            jobType,
            count,
            failCount: Number(hash.failCount ?? 0),
            avgDurationMs: count ? Math.round(totalDurationMs / count) : 0,
            totalEstimatedInputTokens: Number(hash.totalEstimatedInputTokens ?? 0),
            totalEstimatedOutputTokens: Number(hash.totalEstimatedOutputTokens ?? 0),
          });
        }
      }

      return snapshots;
    } catch {
      return [];
    }
  }

  async resetTenant(tenantId: string): Promise<void> {
    try {
      const jobTypes = await this.redis.smembers(tenantJobsSet(tenantId));
      const hashKeys = jobTypes.map((t) => jobHashKey(tenantId, t));
      if (hashKeys.length) await this.redis.del(...hashKeys);
      await this.redis.del(tenantJobsSet(tenantId));
      await this.redis.srem(TENANTS_SET, tenantId);
    } catch {
      // best-effort
    }
  }

  private async recordToRedis(event: AiJobCompleteEvent): Promise<void> {
    try {
      const hashKey = jobHashKey(event.tenantId, event.jobType);
      const pipeline = this.redis.pipeline();
      pipeline.sadd(TENANTS_SET, event.tenantId);
      pipeline.sadd(tenantJobsSet(event.tenantId), event.jobType);
      pipeline.hincrby(hashKey, 'count', 1);
      pipeline.hincrby(hashKey, 'totalDurationMs', event.durationMs);
      if (event.inputTokens != null) {
        pipeline.hincrby(hashKey, 'totalEstimatedInputTokens', event.inputTokens);
      }
      if (event.outputTokens != null) {
        pipeline.hincrby(hashKey, 'totalEstimatedOutputTokens', event.outputTokens);
      }
      await pipeline.exec();
    } catch {
      // best-effort
    }
  }

  private async recordFailToRedis(event: AiJobFailEvent): Promise<void> {
    try {
      const hashKey = jobHashKey(event.tenantId, event.jobType);
      const pipeline = this.redis.pipeline();
      pipeline.sadd(TENANTS_SET, event.tenantId);
      pipeline.sadd(tenantJobsSet(event.tenantId), event.jobType);
      pipeline.hincrby(hashKey, 'failCount', 1);
      pipeline.hincrby(hashKey, 'totalDurationMs', event.durationMs);
      await pipeline.exec();
    } catch {
      // best-effort
    }
  }
}
