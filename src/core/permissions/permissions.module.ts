import { Module } from '@nestjs/common';
import { PermissionsService } from './permissions.service';
import { PermissionGuard } from './permission.guard';

@Module({
  providers: [PermissionsService, PermissionGuard],
  exports: [PermissionsService, PermissionGuard],
})
export class PermissionsModule {}