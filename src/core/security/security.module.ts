import { Global, Module } from '@nestjs/common';
import { BranchValidatorService } from './branch-validator.service';
import { BranchAuthorizationService } from './branch-authorization.service';
import { BranchScopeInterceptor } from './branch-scope.interceptor';
import { TenantIsolationService } from './tenant-isolation.service';
import { EntitlementsService } from './entitlements.service';
import { TenantStatusService } from './tenant-status.service';
import { PooledSalesGuardService } from './pooled-sales-guard';
import { SupabaseModule } from '../../shared/supabase/supabase.module';

@Global()
@Module({
  imports: [SupabaseModule],
  providers: [
    BranchValidatorService,
    BranchAuthorizationService,
    BranchScopeInterceptor,
    TenantIsolationService,
    EntitlementsService,
    TenantStatusService,
    PooledSalesGuardService,
  ],
  exports: [
    BranchValidatorService,
    BranchAuthorizationService,
    BranchScopeInterceptor,
    TenantIsolationService,
    EntitlementsService,
    TenantStatusService,
  ],
})
export class SecurityModule {}
