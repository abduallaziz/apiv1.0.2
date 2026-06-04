import { Module } from '@nestjs/common';
import { ExpenseEngine } from './expense.engine';

@Module({
  providers: [ExpenseEngine],
  exports: [ExpenseEngine],
})
export class ExpenseEngineModule {}