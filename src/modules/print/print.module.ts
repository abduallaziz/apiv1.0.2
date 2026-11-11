import { Module } from '@nestjs/common';
import { PermissionsModule } from '../../core/permissions/permissions.module';
import { PrintController } from './print.controller';
import { PrintService } from './print.service';
import { PrintRepository } from './print.repository';

// StorageModule and AuditModule are @Global().
@Module({
  imports: [PermissionsModule],
  controllers: [PrintController],
  providers: [PrintService, PrintRepository],
})
export class PrintModule {}
