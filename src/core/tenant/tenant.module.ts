import { Module } from '@nestjs/common';
import { TenantGuard } from './tenant.guard';
import { SecurityModule } from '../security/security.module';

@Module({
  imports: [SecurityModule],
  providers: [TenantGuard],
  exports: [TenantGuard, SecurityModule],
})
export class TenantModule {}