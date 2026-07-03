import { Injectable, Inject } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../../shared/supabase/supabase.module';
import { QUEUE_NAMES } from '../../../core/queue/queue.constants';

export interface ComponentHealth {
  status: 'ok' | 'degraded' | 'down';
  latency_ms?: number;
  detail?: string;
}

export interface HealthReport {
  status: 'ok' | 'degraded' | 'down';
  timestamp: string;
  components: {
    database: ComponentHealth;
    redis: ComponentHealth;
    queues: ComponentHealth;
  };
}

export interface QueueHealth {
  name: string;
  status: 'ok' | 'degraded' | 'down';
  waiting: number;
  active: number;
  failed: number;
  delayed: number;
  paused: boolean;
}

@Injectable()
export class HealthService {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
    @InjectQueue(QUEUE_NAMES.DUNNING) private readonly dunningQueue: Queue,
    @InjectQueue(QUEUE_NAMES.AUDIT_CLEANUP) private readonly auditQueue: Queue,
    @InjectQueue(QUEUE_NAMES.NOTIFICATIONS) private readonly notificationsQueue: Queue,
    @InjectQueue(QUEUE_NAMES.DOMAIN_EVENTS) private readonly domainEventsQueue: Queue,
    @InjectQueue(QUEUE_NAMES.AI) private readonly aiQueue: Queue,
    @InjectQueue(QUEUE_NAMES.ANALYTICS) private readonly analyticsQueue: Queue,
  ) {}

  async checkDatabase(): Promise<ComponentHealth> {
    const start = Date.now();
    try {
      const { error } = await this.supabase.from('tenants').select('id').limit(1);
      if (error) throw error;
      return {
        status: 'ok',
        latency_ms: Date.now() - start,
      };
    } catch (err) {
      return {
        status: 'down',
        latency_ms: Date.now() - start,
        detail: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }

  async checkRedis(): Promise<ComponentHealth> {
  const start = Date.now();
  try {
    // نستخدم getWaitingCount كـ indirect Redis ping
    await this.dunningQueue.getWaitingCount();
    return {
      status: 'ok',
      latency_ms: Date.now() - start,
    };
  } catch (err) {
    return {
      status: 'down',
      latency_ms: Date.now() - start,
      detail: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

  async checkQueues(): Promise<{ summary: ComponentHealth; queues: QueueHealth[] }> {
    const queues: Array<{ name: string; queue: Queue }> = [
      { name: QUEUE_NAMES.DUNNING, queue: this.dunningQueue },
      { name: QUEUE_NAMES.AUDIT_CLEANUP, queue: this.auditQueue },
      { name: QUEUE_NAMES.NOTIFICATIONS, queue: this.notificationsQueue },
      { name: QUEUE_NAMES.DOMAIN_EVENTS, queue: this.domainEventsQueue },
      { name: QUEUE_NAMES.AI, queue: this.aiQueue },
      { name: QUEUE_NAMES.ANALYTICS, queue: this.analyticsQueue },
    ];

    const results: QueueHealth[] = [];

    for (const { name, queue } of queues) {
      try {
        const [waiting, active, failed, delayed, isPaused] = await Promise.all([
          queue.getWaitingCount(),
          queue.getActiveCount(),
          queue.getFailedCount(),
          queue.getDelayedCount(),
          queue.isPaused(),
        ]);

        const status: 'ok' | 'degraded' | 'down' =
          failed > 50 ? 'degraded' : isPaused ? 'degraded' : 'ok';

        results.push({ name, status, waiting, active, failed, delayed, paused: isPaused });
      } catch {
        results.push({
          name,
          status: 'down',
          waiting: 0,
          active: 0,
          failed: 0,
          delayed: 0,
          paused: false,
        });
      }
    }

    const hasDown = results.some((q) => q.status === 'down');
    const hasDegraded = results.some((q) => q.status === 'degraded');
    const summary: ComponentHealth = {
      status: hasDown ? 'down' : hasDegraded ? 'degraded' : 'ok',
    };

    return { summary, queues: results };
  }

  async getOverallHealth(): Promise<HealthReport> {
    const [database, redis, queuesResult] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkQueues(),
    ]);

    const components = {
      database,
      redis,
      queues: queuesResult.summary,
    };

    const hasDown = Object.values(components).some((c) => c.status === 'down');
    const hasDegraded = Object.values(components).some((c) => c.status === 'degraded');

    return {
      status: hasDown ? 'down' : hasDegraded ? 'degraded' : 'ok',
      timestamp: new Date().toISOString(),
      components,
    };
  }
}