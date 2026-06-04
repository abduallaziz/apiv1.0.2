import { Module } from '@nestjs/common';
import { PaymentEngine } from './payment.engine';

@Module({
  providers: [PaymentEngine],
  exports: [PaymentEngine],
})
export class PaymentEngineModule {}