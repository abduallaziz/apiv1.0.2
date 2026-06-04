import { IsEnum, IsOptional, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export enum JobStatusFilter {
  ALL = 'all',
  WAITING = 'waiting',
  ACTIVE = 'active',
  COMPLETED = 'completed',
  FAILED = 'failed',
  DELAYED = 'delayed',
}

export enum CleanStatus {
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export class GetQueueJobsDto {
  @IsOptional()
  @IsEnum(JobStatusFilter)
  status?: JobStatusFilter = JobStatusFilter.ALL;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class CleanQueueDto {
  @IsOptional()
  @IsEnum(CleanStatus)
  status?: CleanStatus = CleanStatus.COMPLETED;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  grace?: number = 0;
}