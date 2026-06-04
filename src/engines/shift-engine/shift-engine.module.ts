import { Module } from '@nestjs/common';
import { ShiftEngine } from './shift.engine';

@Module({
  providers: [ShiftEngine],
  exports: [ShiftEngine],
})
export class ShiftEngineModule {}