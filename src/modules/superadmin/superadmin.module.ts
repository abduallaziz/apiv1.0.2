import { Module } from '@nestjs/common';
import { SuperAdminController } from './superadmin.controller';
import { SuperAdminService } from './superadmin.service';
import { AnalyticsController } from './controllers/analytics.controller';
import { AuditLogsController } from './controllers/audit-logs.controller';
import { QueuesController } from './controllers/queues.controller';
import { SuperAdminSubscriptionsController } from './controllers/subscriptions.controller';
import { AuthControlController } from './controllers/auth-control.controller';
import { AuditLogsService } from './services/audit-logs.service';
import { SuperAdminSubscriptionsService } from './services/subscriptions.service';
import { AuthControlService } from './services/auth-control.service';
import { AuditLogsRepository } from './repositories/audit-logs.repository';
import { TenantManagementModule } from '../shared/tenant-management/tenant-management.module';
import { AnalyticsModule } from '../shared/analytics/analytics.module';
import { PermissionsModule } from '../../core/permissions/permissions.module';
import { SupabaseModule } from '../../shared/supabase/supabase.module';
import { QueueModule } from '../../core/queue/queue.module';
import { BillingModule } from '../../core/billing/billing.module';
import { HealthController } from './health/health.controller';
import { HealthService } from './health/health.service';
import { PublicHealthController } from './health/public-health.controller';

@Module({
  imports: [TenantManagementModule, AnalyticsModule, PermissionsModule, SupabaseModule, QueueModule, BillingModule],
  controllers: [
    SuperAdminController,
    AnalyticsController,
    AuditLogsController,
    HealthController,
    QueuesController,
    PublicHealthController,
    SuperAdminSubscriptionsController,
    AuthControlController,
  ],
  providers: [
    SuperAdminService,
    AuditLogsService,
    HealthService,
    AuditLogsRepository,
    SuperAdminSubscriptionsService,
    AuthControlService,
  ],
})
export class SuperAdminModule {}