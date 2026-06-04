import { Module } from '@nestjs/common';
import { BranchValidatorService } from './branch-validator.service';
import { SupabaseModule } from '../../shared/supabase/supabase.module';

@Module({
  imports: [SupabaseModule],
  providers: [BranchValidatorService],
  exports: [BranchValidatorService],
})
export class SecurityModule {}