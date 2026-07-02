import { Module } from '@nestjs/common';
import { PosEngine } from './pos.engine';
import { DiscountEngineModule } from '../discount-engine/discount-engine.module';

@Module({
  imports: [DiscountEngineModule],
  providers: [PosEngine],
  exports: [PosEngine],
})
export class PosEngineModule {}