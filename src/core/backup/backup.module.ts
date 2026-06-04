import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { BackupService } from './backup.service';
import { BackupController } from './backup.controller';
import { BackupScheduler } from './backup.scheduler';
import { SupabaseModule } from '../../shared/supabase/supabase.module';
import { LoggerModule } from '../logger/logger.module';
import { PermissionsModule } from '../permissions/permissions.module';

@Module({
  imports: [
    SupabaseModule,
    LoggerModule,
    PermissionsModule,
    BullModule.registerQueue({ name: 'dunning' }),
  ],
  controllers: [BackupController],
  providers: [BackupService, BackupScheduler],
  exports: [BackupService],
})
export class BackupModule {}