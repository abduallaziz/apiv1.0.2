import { Module } from '@nestjs/common';
import { ApprovalEngine } from './approval.engine';

@Module({
  providers: [ApprovalEngine],
  exports: [ApprovalEngine],
})
export class ApprovalEngineModule {}