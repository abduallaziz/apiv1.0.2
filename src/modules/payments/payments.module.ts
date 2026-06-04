import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { BillingModule } from '../../core/billing/billing.module';

@Module({
  imports: [BillingModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule {}