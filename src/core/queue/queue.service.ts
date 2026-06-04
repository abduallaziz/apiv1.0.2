import { Injectable, BadRequestException } from '@nestjs/common';
import { Queue, JobProgress } from 'bullmq';
import { QueueRegistry } from './queue.registry';

export type JobStatus = 'waiting' | 'active' | 'completed' | 'failed' | 'delayed';
export type JobStatusFilter = JobStatus | 'all';
export type NormalizedJobStatus = JobStatus | 'unknown';

const MIN_GRACE_MS = 60 * 1000;

export interface QueueStats {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: boolean;
}

export interface JobSnapshot {
  id: string;
  name: string;
  data: unknown;
  progress: JobProgress;
  attempts: number;
  maxAttempts: number;
  failedReason: string | null;
  createdAt: number;
  processedAt: number | null;
  finishedAt: number | null;
}

export interface JobDetail extends JobSnapshot {
  status: NormalizedJobStatus;
}

@Injectable()
export class QueueService {
  constructor(private readonly registry: QueueRegistry) {}

  private getQueueOrThrow(name: string): Queue {
    const queue = this.registry.get(name);
    if (!queue) {
      throw new BadRequestException(`Queue "${name}" not found`);
    }
    return queue;
  }

  async getAllQueuesStats(): Promise<QueueStats[]> {
    return Promise.all(
      this.registry.getNames().map(async (name) => {
        const queue = this.registry.get(name)!;
        const [counts, isPaused] = await Promise.all([
          queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed'),
          queue.isPaused(),
        ]);
        return {
          name,
          waiting: counts.waiting ?? 0,
          active: counts.active ?? 0,
          completed: counts.completed ?? 0,
          failed: counts.failed ?? 0,
          delayed: counts.delayed ?? 0,
          paused: isPaused,
        } satisfies QueueStats;
      }),
    );
  }

  async getQueueJobs(
    name: string,
    status: JobStatusFilter,
    page: number,
    limit: number,
  ): Promise<{ jobs: JobSnapshot[]; total: number }> {
    const queue = this.getQueueOrThrow(name);
    const start = (page - 1) * limit;
    const end = start + limit - 1;

    const types: JobStatus[] =
      status === 'all'
        ? ['waiting', 'active', 'completed', 'failed', 'delayed']
        : [status];

    const [rawJobs, total] = await Promise.all([
      queue.getJobs(types, start, end),
      this.getTotalCount(queue, status),
    ]);

    const jobs: JobSnapshot[] = rawJobs.map((job) => ({
      id: String(job.id),
      name: job.name,
      data: job.data as unknown,
      progress: job.progress,
      attempts: job.attemptsMade,
      maxAttempts: job.opts.attempts ?? 1,
      failedReason: job.failedReason ?? null,
      createdAt: job.timestamp,
      processedAt: job.processedOn ?? null,
      finishedAt: job.finishedOn ?? null,
    }));

    return { jobs, total };
  }

  async getJob(queueName: string, jobId: string): Promise<JobDetail> {
    const queue = this.getQueueOrThrow(queueName);
    const job = await queue.getJob(jobId);
    if (!job) {
      throw new BadRequestException(`Job "${jobId}" not found in queue "${queueName}"`);
    }
    const state = await job.getState();
    return {
      id: String(job.id),
      name: job.name,
      data: job.data as unknown,
      status: (state as NormalizedJobStatus) ?? 'unknown',
      progress: job.progress,
      attempts: job.attemptsMade,
      maxAttempts: job.opts.attempts ?? 1,
      failedReason: job.failedReason ?? null,
      createdAt: job.timestamp,
      processedAt: job.processedOn ?? null,
      finishedAt: job.finishedOn ?? null,
    };
  }

  async pauseQueue(name: string): Promise<void> {
    await this.getQueueOrThrow(name).pause();
  }

  async resumeQueue(name: string): Promise<void> {
    await this.getQueueOrThrow(name).resume();
  }

  async retryJob(queueName: string, jobId: string): Promise<void> {
    const queue = this.getQueueOrThrow(queueName);
    const job = await queue.getJob(jobId);
    if (!job) {
      throw new BadRequestException(`Job "${jobId}" not found`);
    }
    const state = await job.getState();
    if (state !== 'failed') {
      throw new BadRequestException(
        `Job "${jobId}" cannot be retried (current state: ${state})`,
      );
    }
    await job.moveToWait();
  }

  async cleanQueue(
    queueName: string,
    grace: number,
    status: 'completed' | 'failed',
  ): Promise<number> {
    if (status === 'failed' && grace < MIN_GRACE_MS) {
      throw new BadRequestException(
        `Unsafe cleanup: grace must be at least ${MIN_GRACE_MS}ms for failed jobs`,
      );
    }
    const queue = this.getQueueOrThrow(queueName);
    const removed = await queue.clean(grace, 100, status);
    return removed.length;
  }

  private async getTotalCount(queue: Queue, status: JobStatusFilter): Promise<number> {
    if (status === 'all') {
      const counts = await queue.getJobCounts(
        'waiting', 'active', 'completed', 'failed', 'delayed',
      );
      return Object.values(counts).reduce((a, b) => a + b, 0);
    }
    const counts = await queue.getJobCounts(status);
    return counts[status] ?? 0;
  }
}