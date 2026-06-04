import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { NOTIFICATION_QUEUE } from '../notification.constants';
import { NotificationService } from '../notification.service';
import { SendNotificationDto } from '../dto/send-notification.dto';

@Processor(NOTIFICATION_QUEUE)
export class NotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(private readonly notificationService: NotificationService) {
    super();
  }

  async process(job: Job<SendNotificationDto>): Promise<void> {
    this.logger.debug(
      `Processing job ${job.id} — type: ${job.data.type} channel: ${job.data.channel}`,
    );
    try {
      await this.notificationService.processJob(job.data);
    } catch (error) {
      this.logger.error(`Job ${job.id} failed: ${(error as Error).message}`);
      throw error;
    }
  }
}