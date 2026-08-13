import { Module } from '@nestjs/common';
import { AccountingController } from './accounting.controller';
import { PriceOverrideAuditController } from './price-override-audit.controller';
import { AccountingConfigController } from './accounting-config.controller';
import { AccountingService } from './accounting.service';
import { AccountingRepository } from './repositories/accounting.repository';
import { CoreAuthModule } from '../../core/auth/auth.module';

@Module({
  imports: [CoreAuthModule],
  controllers: [
    AccountingController,
    PriceOverrideAuditController,
    AccountingConfigController,
  ],
  providers: [AccountingService, AccountingRepository],
  exports: [AccountingService],
})
export class AccountingModule {}
