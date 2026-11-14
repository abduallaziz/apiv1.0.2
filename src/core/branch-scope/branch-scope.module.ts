import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { BranchWarehouseScopeInterceptor } from './branch-warehouse-scope.interceptor';

/** Registers the warehouse-based branch scope for every HTTP request (no-op unless isolated). */
@Global()
@Module({
  providers: [
    { provide: APP_INTERCEPTOR, useClass: BranchWarehouseScopeInterceptor },
  ],
})
export class BranchScopeModule {}
