import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { BillingService } from './billing.service';
import { BillingInvoiceService } from './billing-invoice.service';
import { MockPaymentProvider } from './providers/mock-payment.provider';
import { StripePaymentProvider } from './providers/stripe-payment.provider';
import { PAYMENT_PROVIDER } from './billing.constants';
import { DunningService } from './dunning/dunning.service';
import { DunningScheduler } from './dunning/dunning.scheduler';
import { StripeWebhookController } from './stripe-webhook.controller';
import { SupabaseModule } from '../../shared/supabase/supabase.module';
import { NotificationModule } from '../notification/notification.module';
import { PaymentsRepository } from './repositories/payments.repository';
import { InvoicesRepository } from './repositories/invoices.repository';
import { BillingCustomersRepository } from './repositories/billing-customers.repository';
import { QUEUE_NAMES } from '../queue/queue.constants';

@Module({
  imports: [
    SupabaseModule,
    ConfigModule,
    NotificationModule,
    BullModule.registerQueue({ name: QUEUE_NAMES.DUNNING }),
  ],
  controllers: [StripeWebhookController],
  providers: [
    BillingService,
    BillingInvoiceService,
    DunningService,
    DunningScheduler,
    StripePaymentProvider,
    MockPaymentProvider,
    PaymentsRepository,
    InvoicesRepository,
    BillingCustomersRepository,
    {
      provide: PAYMENT_PROVIDER,
      useFactory: (config: ConfigService, stripe: StripePaymentProvider, mock: MockPaymentProvider) => {
        const provider = config.get<string>('PAYMENT_PROVIDER', 'mock');
        return provider === 'stripe' ? stripe : mock;
      },
      inject: [ConfigService, StripePaymentProvider, MockPaymentProvider],
    },
  ],
  exports: [
    BillingService,
    BillingInvoiceService,
    DunningService,
    PaymentsRepository,
    InvoicesRepository,
    BillingCustomersRepository,
  ],
})
export class BillingModule {}