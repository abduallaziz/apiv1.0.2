import { Module } from '@nestjs/common';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';
import { TenantsRepository } from './repositories/tenants.repository';
import { PermissionsModule } from '../../core/permissions/permissions.module';

// Owner-facing module ONLY.
// No admin tooling. No soft delete. No activate/deactivate. No feature overrides.
// tenant_id always comes from JWT via TenantContext — never from request body or params.

@Module({
  imports: [PermissionsModule],
  controllers: [TenantsController],
  providers: [TenantsService, TenantsRepository],
  exports: [TenantsService],
})
export class TenantsModule {}