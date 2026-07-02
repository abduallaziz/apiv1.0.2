import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, JobsOptions } from 'bullmq';
import { AI_PRIORITY, QUEUE_NAMES } from './queue.constants';
import { AiJobData, AiJobName } from './processors/ai.processor';

export type AiJobPriority = 'high' | 'normal';

export interface EnqueueAiJobOptions {
  /** Job type — one of AI_JOB_NAMES. */
  name: AiJobName;
  /**
   * Payload passed to the processor.
   * Must include tenant_id for usage tracking.
   * Populate estimated_input_tokens when the prompt size is known upfront.
   */
  data: AiJobData;
  /** 'high' runs before 'normal'; defaults to 'normal'. */
  priority?: AiJobPriority;
  /** Override any BullMQ job option (delay, attempts, etc.). */
  jobOptions?: Omit<JobsOptions, 'priority'>;
}

@Injectable()
export class AiQueueService {
  constructor(
    @InjectQueue(QUEUE_NAMES.AI) private readonly aiQueue: Queue,
  ) {}

  async enqueue(opts: EnqueueAiJobOptions) {
    const bullPriority =
      opts.priority === 'high' ? AI_PRIORITY.HIGH : AI_PRIORITY.NORMAL;

    return this.aiQueue.add(opts.name, opts.data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
      ...opts.jobOptions,
      priority: bullPriority,
    });
  }

  async enqueueHigh(
    name: AiJobName,
    data: AiJobData,
    jobOptions?: Omit<JobsOptions, 'priority'>,
  ) {
    return this.enqueue({ name, data, priority: 'high', jobOptions });
  }

  async enqueueNormal(
    name: AiJobName,
    data: AiJobData,
    jobOptions?: Omit<JobsOptions, 'priority'>,
  ) {
    return this.enqueue({ name, data, priority: 'normal', jobOptions });
  }

  async getQueueStats() {
    const counts = await this.aiQueue.getJobCounts(
      'waiting', 'active', 'completed', 'failed', 'delayed',
    );
    return { queue: QUEUE_NAMES.AI, ...counts };
  }
}
