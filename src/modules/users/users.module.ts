import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { UsersRepository } from './users.repository';
import { AuditModule } from '../../core/audit/audit.module';
import { PermissionsModule } from '../../core/permissions/permissions.module';
import { BillingModule } from '../../core/billing/billing.module';

@Module({
  imports: [AuditModule, PermissionsModule, BillingModule],
  controllers: [UsersController],
  providers: [UsersService, UsersRepository],
  exports: [UsersService, UsersRepository],
})
export class UsersModule {}