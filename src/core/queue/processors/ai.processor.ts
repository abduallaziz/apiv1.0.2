import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { AI_QUEUE_CONCURRENCY, QUEUE_NAMES } from '../queue.constants';
import { AiUsageTrackingService } from '../../ai-usage/ai-usage-tracking.service';

export const AI_JOB_NAMES = {
  SUMMARIZE: 'ai.summarize',
  CLASSIFY: 'ai.classify',
  EXTRACT: 'ai.extract',
  EMBED: 'ai.embed',
} as const;

export type AiJobName = (typeof AI_JOB_NAMES)[keyof typeof AI_JOB_NAMES];

/**
 * Job data contract — all AI jobs must include tenant_id.
 * Callers should also populate estimated_input_tokens when known upfront.
 */
export interface AiJobData {
  tenant_id: string;
  user_id?: string;
  estimated_input_tokens?: number;
  [key: string]: unknown;
}

/**
 * Return value contract — handlers should include token counts when available.
 */
export interface AiJobResult {
  input_tokens?: number;
  output_tokens?: number;
  [key: string]: unknown;
}

/**
 * Processes AI jobs from the dedicated AI queue.
 * Concurrency is capped at AI_QUEUE_CONCURRENCY so AI workloads
 * never starve other queues (dunning, notifications, domain-events).
 */
@Processor(QUEUE_NAMES.AI, { concurrency: AI_QUEUE_CONCURRENCY })
export class AiProcessor extends WorkerHost {
  private readonly logger = new Logger(AiProcessor.name);

  constructor(private readonly aiUsage: AiUsageTrackingService) {
    super();
  }

  async process(job: Job<AiJobData>): Promise<AiJobResult | null> {
    const tenantId = job.data.tenant_id;
    const userId = job.data.user_id;
    const start = Date.now();

    this.logger.log(`AI job started: ${job.name} [${job.id}] priority=${job.opts.priority ?? 'none'} tenant=${tenantId}`);

    this.aiUsage.trackStart({
      jobId: job.id ?? 'unknown',
      jobType: job.name,
      tenantId,
      userId,
      estimatedInputTokens: job.data.estimated_input_tokens,
    });

    let result: AiJobResult | null;

    try {
      switch (job.name as AiJobName) {
        case AI_JOB_NAMES.SUMMARIZE:
          result = await this.handleSummarize(job);
          break;
        case AI_JOB_NAMES.CLASSIFY:
          result = await this.handleClassify(job);
          break;
        case AI_JOB_NAMES.EXTRACT:
          result = await this.handleExtract(job);
          break;
        case AI_JOB_NAMES.EMBED:
          result = await this.handleEmbed(job);
          break;
        default:
          this.logger.warn(`Unknown AI job: ${job.name}`);
          return null;
      }
    } catch (err: unknown) {
      const durationMs = Date.now() - start;
      this.aiUsage.trackFail({
        jobId: job.id ?? 'unknown',
        jobType: job.name,
        tenantId,
        userId,
        durationMs,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    const durationMs = Date.now() - start;
    this.aiUsage.trackComplete({
      jobId: job.id ?? 'unknown',
      jobType: job.name,
      tenantId,
      userId,
      durationMs,
      inputTokens: result?.input_tokens,
      outputTokens: result?.output_tokens,
    });

    this.logger.log(`AI job completed: ${job.name} [${job.id}] duration=${durationMs}ms`);
    return result;
  }

  private async handleSummarize(job: Job<AiJobData>): Promise<AiJobResult> {
    // Placeholder — replace with actual LLM call (e.g. Anthropic SDK).
    // Populate input_tokens / output_tokens from the API response when available.
    this.logger.debug(`Summarizing payload for job ${job.id}`);
    return { summary: null, input_tokens: undefined, output_tokens: undefined };
  }

  private async handleClassify(job: Job<AiJobData>): Promise<AiJobResult> {
    this.logger.debug(`Classifying payload for job ${job.id}`);
    return { label: null, input_tokens: undefined, output_tokens: undefined };
  }

  private async handleExtract(job: Job<AiJobData>): Promise<AiJobResult> {
    this.logger.debug(`Extracting structured data for job ${job.id}`);
    return { fields: null, input_tokens: undefined, output_tokens: undefined };
  }

  private async handleEmbed(job: Job<AiJobData>): Promise<AiJobResult> {
    this.logger.debug(`Generating embeddings for job ${job.id}`);
    return { vector: null, input_tokens: undefined, output_tokens: undefined };
  }
}
