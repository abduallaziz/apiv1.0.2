import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../core/auth/jwt-auth.guard';
import { PermissionGuard } from '../../../core/permissions/permission.guard';
import { RequirePermission } from '../../../core/permissions/require-permission.decorator';
import { QueueService } from '../../../core/queue/queue.service';
import { QueueExistsPipe } from '../../../core/queue/pipes/queue-exists.pipe';
import { GetQueueJobsDto, CleanQueueDto } from '../dto/queue-jobs.dto';

@Controller('superadmin/queues')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class QueuesController {
  constructor(private readonly queueService: QueueService) {}

  @Get()
  @RequirePermission('superadmin.queue.view')
  async getAllQueues() {
    const stats = await this.queueService.getAllQueuesStats();
    return { queues: stats, total: stats.length };
  }

  @Get(':name/jobs')
  @RequirePermission('superadmin.queue.view')
  async getQueueJobs(
    @Param('name', QueueExistsPipe) name: string,
    @Query() dto: GetQueueJobsDto,
  ) {
    const result = await this.queueService.getQueueJobs(
      name,
      dto.status ?? 'all',
      dto.page ?? 1,
      dto.limit ?? 20,
    );
    return { queue: name, ...result, page: dto.page ?? 1, limit: dto.limit ?? 20 };
  }

  @Get(':name/jobs/:jobId')
  @RequirePermission('superadmin.queue.view')
  async getJob(
    @Param('name', QueueExistsPipe) name: string,
    @Param('jobId') jobId: string,
  ) {
    try {
      const job = await this.queueService.getJob(name, jobId);
      return { queue: name, job };
    } catch (err) {
      throw new NotFoundException((err as Error).message);
    }
  }

  @Post(':name/pause')
  @RequirePermission('superadmin.queue.manage')
  async pauseQueue(@Param('name', QueueExistsPipe) name: string) {
    await this.queueService.pauseQueue(name);
    return { success: true, queue: name, status: 'paused' };
  }

  @Post(':name/resume')
  @RequirePermission('superadmin.queue.manage')
  async resumeQueue(@Param('name', QueueExistsPipe) name: string) {
    await this.queueService.resumeQueue(name);
    return { success: true, queue: name, status: 'resumed' };
  }

  @Post(':name/jobs/:jobId/retry')
  @RequirePermission('superadmin.queue.manage')
  async retryJob(
    @Param('name', QueueExistsPipe) name: string,
    @Param('jobId') jobId: string,
  ) {
    try {
      await this.queueService.retryJob(name, jobId);
      return { success: true, queue: name, jobId, action: 'retried' };
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
  }

  @Post(':name/clean')
  @RequirePermission('superadmin.queue.manage')
  async cleanQueue(
    @Param('name', QueueExistsPipe) name: string,
    @Body() dto: CleanQueueDto,
  ) {
    const removed = await this.queueService.cleanQueue(
      name,
      dto.grace ?? 0,
      dto.status ?? 'completed',
    );
    return { success: true, queue: name, removed, status: dto.status ?? 'completed' };
  }
}