import { Module } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import {
  SupabaseModule,
  SUPABASE_CLIENT,
} from '../../shared/supabase/supabase.module';
import { ApprovalEngine } from './approval.engine';
import { ApprovalHistoryRepository } from './approval-history.repository';

@Module({
  imports: [SupabaseModule],
  providers: [
    ApprovalEngine,
    {
      provide: ApprovalHistoryRepository,
      useFactory: (supabase: SupabaseClient) =>
        new ApprovalHistoryRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
  ],
  exports: [ApprovalEngine, ApprovalHistoryRepository],
})
export class ApprovalEngineModule {}
