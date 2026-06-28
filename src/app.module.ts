import { Module, MiddlewareConsumer, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { throttlerConfig } from './core/security/throttler.config';
import { IpMiddleware } from './core/security/ip.middleware';
import { SupabaseModule } from './shared/supabase/supabase.module';
import { SecurityModule } from './core/security/security.module';
import { PermissionsModule } from './core/permissions/permissions.module';
import { FeatureFlagsModule } from './core/feature-flags/feature-flags.module';
import { CoreAuthModule } from './core/auth/auth.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { BranchesModule } from './modules/branches/branches.module';
import { ItemsModule } from './modules/items/items.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { ShiftsModule } from './modules/shifts/shifts.module';
import { ExpensesModule } from './modules/expenses/expenses.module';
import { CustomersModule } from './modules/customers/customers.module';
import { BillingModule } from './core/billing/billing.module';
import { PlansModule } from './modules/plans/plans.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { ReportsModule } from './modules/reports/reports.module';
import { SuperAdminModule } from './modules/superadmin/superadmin.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { QueueModule } from './core/queue/queue.module';
import { NotificationModule } from './core/notification/notification.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { I18nModule } from './core/i18n/i18n.module';
import { LoggerModule } from './core/logger/logger.module';
import { MetricsModule } from './core/metrics/metrics.module';
import { BackupModule } from './core/backup/backup.module';
import { SecretsModule } from './core/secrets/secrets.module';
import { envValidationSchema } from './core/secrets/config/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      validationOptions: {
        abortEarly: false,
        allowUnknown: true,
      },
    }),
    ThrottlerModule.forRoot(throttlerConfig),
    ScheduleModule.forRoot(),
    SecretsModule,
    LoggerModule,
    SupabaseModule,
    SecurityModule,
    PermissionsModule,
    FeatureFlagsModule,
    CoreAuthModule,
    BillingModule,
    AuthModule,
    UsersModule,
    BranchesModule,
    ItemsModule,
    InventoryModule,
    InvoicesModule,
    ShiftsModule,
    ExpensesModule,
    CustomersModule,
    PlansModule,
    SubscriptionsModule,
    ReportsModule,
    SuperAdminModule,
    TenantsModule,
    PaymentsModule,
    QueueModule,
    NotificationModule,
    NotificationsModule,
    I18nModule,
    MetricsModule,
    BackupModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(IpMiddleware).forRoutes({ path: '*path', method: RequestMethod.ALL });
  }
}