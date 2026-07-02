import { Injectable, Logger, Inject } from '@nestjs/common';
import { BillingCustomersRepository } from './repositories/billing-customers.repository';
import { InvoicesRepository } from './repositories/invoices.repository';
import { PaymentsRepository } from './repositories/payments.repository';
import { PaymentProvider } from './providers/payment-provider.interface';
import { PAYMENT_PROVIDER } from './billing.constants';

export interface GenerateInvoiceInput {
  tenantId: string;
  subscriptionId: string;
  planName: string;
  planPrice: number;
  currency: string;
  periodStart: Date;
  periodEnd: Date;
  tenantEmail: string;
  tenantName: string;
}

export interface GenerateInvoiceResult {
  invoiceId: string;
  invoiceNumber: string;
  totalAmount: number;
  status: string;
}

export interface ProcessPaymentInput {
  tenantId: string;
  invoiceId: string;
  tenantEmail: string;
  tenantName: string;
}

export interface ProcessPaymentResult {
  paymentId: string;
  status: 'pending' | 'succeeded' | 'failed';
  failureReason?: string;
}

@Injectable()
export class BillingInvoiceService {
  private readonly logger = new Logger(BillingInvoiceService.name);

  constructor(
    private readonly billingCustomersRepo: BillingCustomersRepository,
    private readonly invoicesRepo: InvoicesRepository,
    private readonly paymentsRepo: PaymentsRepository,
    @Inject(PAYMENT_PROVIDER) private readonly paymentProvider: PaymentProvider,
  ) {}

  async generateInvoice(input: GenerateInvoiceInput): Promise<GenerateInvoiceResult> {
    const dueAt = new Date(input.periodEnd);
    dueAt.setDate(dueAt.getDate() + 7);

    const invoice = await this.invoicesRepo.create({
      tenantId: input.tenantId,
      subscriptionId: input.subscriptionId,
      currency: input.currency,
      subtotal: input.planPrice,
      taxAmount: 0,
      discountAmount: 0,
      totalAmount: input.planPrice,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      dueAt,
      items: [
        {
          description: `${input.planName} — ${input.periodStart.toISOString().slice(0, 10)} to ${input.periodEnd.toISOString().slice(0, 10)}`,
          quantity: 1,
          unitPrice: input.planPrice,
          amount: input.planPrice,
          metadata: { plan_name: input.planName },
        },
      ],
    });

    this.logger.log(`Invoice generated: ${invoice.invoice_number} for tenant: ${input.tenantId}`);

    return {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoice_number,
      totalAmount: invoice.total_amount,
      status: invoice.status,
    };
  }

  async processPayment(input: ProcessPaymentInput): Promise<ProcessPaymentResult> {
    const invoice = await this.invoicesRepo.findById(input.invoiceId, input.tenantId);
    if (!invoice) throw new Error(`Invoice not found: ${input.invoiceId}`);

    let billingCustomer = await this.billingCustomersRepo.findByTenant(
      input.tenantId,
      this.paymentProvider.providerName,
    );

    if (!billingCustomer) {
      const result = await this.paymentProvider.createCustomer({
        tenantId: input.tenantId,
        email: input.tenantEmail,
        name: input.tenantName,
      });

      billingCustomer = await this.billingCustomersRepo.create({
        tenantId: input.tenantId,
        provider: this.paymentProvider.providerName,
        providerCustomerId: result.providerCustomerId,
        email: input.tenantEmail,
      });
    }

    const payment = await this.paymentsRepo.create({
      tenantId: input.tenantId,
      invoiceId: invoice.id,
      provider: this.paymentProvider.providerName,
      amount: invoice.total_amount,
      currency: invoice.currency,
    });

    const result = await this.paymentProvider.createPayment({
      tenantId: input.tenantId,
      providerCustomerId: billingCustomer.provider_customer_id,
      invoiceId: invoice.id,
      amount: invoice.total_amount,
      currency: invoice.currency,
      description: `Invoice ${invoice.invoice_number}`,
    });

    await this.paymentsRepo.updateStatus(payment.id, result.status, {
      providerPaymentId: result.providerPaymentId,
      failureReason: result.failureReason,
      paidAt: result.status === 'succeeded' ? new Date() : undefined,
    });

    if (result.status === 'succeeded') {
      await this.invoicesRepo.markPaid(invoice.id);
      this.logger.log(`Payment succeeded for invoice: ${invoice.invoice_number}`);
    } else {
      this.logger.warn(`Payment failed for invoice: ${invoice.invoice_number} — ${result.failureReason}`);
    }

    return {
      paymentId: payment.id,
      status: result.status,
      failureReason: result.failureReason,
    };
  }

  async getInvoicesWithPayments(tenantId: string, limit = 20, offset = 0) {
    const { data: invoices, count } = await this.invoicesRepo.findByTenant(tenantId, limit, offset);

    const enriched = await Promise.all(
      invoices.map(async (invoice) => {
        const payments = await this.paymentsRepo.findByInvoice(invoice.id);
        return { ...invoice, payments };
      }),
    );

    return { data: enriched, count };
  }

  async getInvoiceDetail(invoiceId: string, tenantId: string) {
    const invoice = await this.invoicesRepo.findById(invoiceId, tenantId);
    if (!invoice) return null;

    const [items, payments] = await Promise.all([
      this.invoicesRepo.findItemsByInvoice(invoiceId),
      this.paymentsRepo.findByInvoice(invoiceId),
    ]);

    return { ...invoice, items, payments };
  }
}