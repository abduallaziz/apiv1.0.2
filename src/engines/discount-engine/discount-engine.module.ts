import { Module } from '@nestjs/common';
import { DiscountEngine } from './discount.engine';

@Module({
  providers: [DiscountEngine],
  exports: [DiscountEngine],
})
export class DiscountEngineModule {}