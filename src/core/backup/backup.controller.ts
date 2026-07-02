import { Controller, Get, UseGuards } from '@nestjs/common';
import { BackupService } from './backup.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../permissions/permission.guard';
import { RequirePermission } from '../permissions/require-permission.decorator';
import { BackupStatusReport } from './interfaces/backup-status.interface';

@Controller('superadmin/backup')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class BackupController {
  constructor(private readonly backupService: BackupService) {}

  @Get('status')
  @RequirePermission('superadmin.backup.view')
  async getStatus(): Promise<BackupStatusReport> {
    return this.backupService.getBackupStatus();
  }
}