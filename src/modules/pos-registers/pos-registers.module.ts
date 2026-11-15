import { Module } from '@nestjs/common';
import { PosRegistersController } from './pos-registers.controller';
import { PosRegistersService } from './pos-registers.service';
import { PosRegistersRepository } from './pos-registers.repository';
import { BillingModule } from '../../core/billing/billing.module';
import { PermissionsModule } from '../../core/permissions/permissions.module';

@Module({
  imports: [BillingModule, PermissionsModule],
  controllers: [PosRegistersController],
  providers: [PosRegistersService, PosRegistersRepository],
  exports: [PosRegistersService],
})
export class PosRegistersModule {}
