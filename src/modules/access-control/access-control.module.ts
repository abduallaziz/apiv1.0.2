import { Module } from '@nestjs/common';
import { AccessControlController } from './access-control.controller';
import { AccessControlService } from './access-control.service';
import { AccessControlRepository } from './access-control.repository';
import { AccessControlAdminGuard } from './guards/access-control-admin.guard';

// PermissionsService and AuditService are provided by @Global() modules
// (PermissionsModule, AuditModule) and don't need to be imported here.
@Module({
  controllers: [AccessControlController],
  providers: [AccessControlService, AccessControlRepository, AccessControlAdminGuard],
  exports: [AccessControlService],
})
export class AccessControlModule {}
