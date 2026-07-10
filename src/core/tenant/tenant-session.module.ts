import { Global, Module } from '@nestjs/common';
import { PgPoolModule } from '../../shared/database/pg-pool.module';
import { TenantSessionService } from './tenant-session.service';

@Global()
@Module({
  imports: [PgPoolModule],
  providers: [TenantSessionService],
  exports: [TenantSessionService],
})
export class TenantSessionModule {}
