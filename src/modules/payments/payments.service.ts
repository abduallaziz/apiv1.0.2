import { Injectable, NotFoundException } from '@nestjs/common';
import { BillingInvoiceService } from '../../core/billing/billing-invoice.service';
import { PaymentsRepository } from '../../core/billing/repositories/payments.repository';
import { InvoicesRepository } from '../../core/billing/repositories/invoices.repository';
import { TenantContext } from '../../core/tenant/tenant.context';
import { QueryPaymentsDto } from './dto/query-payments.dto';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly billingInvoiceService: BillingInvoiceService,
    private readonly paymentsRepo: PaymentsRepository,
    private readonly invoicesRepo: InvoicesRepository,
  ) {}

  async getPaymentHistory(tenant: TenantContext, dto: QueryPaymentsDto) {
    const limit = dto.limit ?? 20;
    const offset = ((dto.page ?? 1) - 1) * limit;

    const { data, count } = await this.paymentsRepo.findByTenant(
      tenant.tenantId,
      limit,
      offset,
    );

    return {
      data,
      meta: {
        total: count,
        page: dto.page ?? 1,
        limit,
        pages: Math.ceil(count / limit),
      },
    };
  }

  async getInvoices(tenant: TenantContext, dto: QueryPaymentsDto) {
    const limit = dto.limit ?? 20;
    const offset = ((dto.page ?? 1) - 1) * limit;

    const { data, count } = await this.billingInvoiceService.getInvoicesWithPayments(
      tenant.tenantId,
      limit,
      offset,
    );

    return {
      data,
      meta: {
        total: count,
        page: dto.page ?? 1,
        limit,
        pages: Math.ceil(count / limit),
      },
    };
  }

  async getInvoiceDetail(tenant: TenantContext, invoiceId: string) {
    const invoice = await this.billingInvoiceService.getInvoiceDetail(
      invoiceId,
      tenant.tenantId,
    );

    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }

  async getInvoicePayments(tenant: TenantContext, invoiceId: string) {
    const invoice = await this.invoicesRepo.findById(invoiceId, tenant.tenantId);
    if (!invoice) throw new NotFoundException('Invoice not found');

    const payments = await this.paymentsRepo.findByInvoice(invoiceId);
    return { invoice, payments };
  }
}