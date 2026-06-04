import { Module } from '@nestjs/common';
import { SuperAdminController } from './superadmin.controller';
import { SuperAdminService } from './superadmin.service';
import { AnalyticsController } from './controllers/analytics.controller';
import { AuditLogsController } from './controllers/audit-logs.controller';
import { QueuesController } from './controllers/queues.controller';
import { AuditLogsService } from './services/audit-logs.service';
import { AuditLogsRepository } from './repositories/audit-logs.repository';
import { TenantManagementModule } from '../shared/tenant-management/tenant-management.module';
import { AnalyticsModule } from '../shared/analytics/analytics.module';
import { PermissionsModule } from '../../core/permissions/permissions.module';
import { SupabaseModule } from '../../shared/supabase/supabase.module';
import { QueueModule } from '../../core/queue/queue.module';
import { HealthController } from './health/health.controller';
import { HealthService } from './health/health.service';


@Module({
  imports: [TenantManagementModule, AnalyticsModule, PermissionsModule, SupabaseModule, QueueModule],
  controllers: [SuperAdminController, AnalyticsController, AuditLogsController,HealthController, QueuesController],
  providers: [SuperAdminService, AuditLogsService, HealthService, AuditLogsRepository ],
})
export class SuperAdminModule {}