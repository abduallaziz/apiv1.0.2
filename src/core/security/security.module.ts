import { Global, Module } from '@nestjs/common';
import { BranchValidatorService } from './branch-validator.service';
import { BranchAuthorizationService } from './branch-authorization.service';
import { BranchScopeInterceptor } from './branch-scope.interceptor';
import { SupabaseModule } from '../../shared/supabase/supabase.module';

@Global()
@Module({
  imports: [SupabaseModule],
  providers: [
    BranchValidatorService,
    BranchAuthorizationService,
    BranchScopeInterceptor,
  ],
  exports: [
    BranchValidatorService,
    BranchAuthorizationService,
    BranchScopeInterceptor,
  ],
})
export class SecurityModule {}
