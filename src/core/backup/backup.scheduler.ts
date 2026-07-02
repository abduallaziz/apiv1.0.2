import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BackupService } from './backup.service';

@Injectable()
export class BackupScheduler {
  constructor(private readonly backupService: BackupService) {}

  // يعمل كل يوم الساعة 6 صباحاً
  @Cron('0 6 * * *')
  async runDailyCheck(): Promise<void> {
    await this.backupService.runDailyIntegrityCheck();
  }
}