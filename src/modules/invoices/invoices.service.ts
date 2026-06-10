import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InvoicesRepository } from './repositories/invoices.repository';
import { PosEngine } from '../../engines/pos-engine/pos.engine';
import { PaymentEngine } from '../../engines/payment-engine/payment.engine';
import { AuditService } from '../../core/audit/audit.service';
import { MetricsService } from '../../core/metrics/metrics.service';
import { TenantContext } from '../../core/tenant/tenant-context';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { CancelInvoiceDto } from './dto/cancel-invoice.dto';

@Injectable()
export class InvoicesService {
  constructor(
    private readonly repo: InvoicesRepository,
    private readonly posEngine: PosEngine,
    private readonly paymentEngine: PaymentEngine,
    private readonly auditService: AuditService,
    private readonly metricsService: MetricsService,
  ) {}

  async create(
    tenant: TenantContext,
    dto: CreateInvoiceDto,
    cashierId: string,
    actorRole: string,
    branchId: string,
    shiftId: string,
    ip: string,
    device: string,
  ) {
    const built = this.posEngine.buildInvoice(
      dto.items,
      dto.discount,
      dto.tax_rate ?? 0,
    );

    if (dto.payment_method === 'cash') {
      if (!dto.cash_tendered) {
        throw new BadRequestException('cash_tendered required for cash payment');
      }
      this.paymentEngine.processCashPayment(built.total, dto.cash_tendered);
    } else if (dto.payment_method === 'split') {
      if (dto.cash_amount === undefined || dto.card_amount === undefined) {
        throw new BadRequestException(
          'cash_amount and card_amount required for split payment',
        );
      }
      this.paymentEngine.processSplitPayment(
        built.total,
        dto.cash_amount,
        dto.card_amount,
      );
    }

    const invoice = await this.repo.create(tenant, {
      branch_id: branchId,
      cashier_id: cashierId,
      customer_id: dto.customer_id ?? null,
      status: 'completed',
      subtotal: built.subtotal,
      discount: built.discount_amount,
      tax: built.tax_amount,
      total: built.total,
      payment_method: dto.payment_method,
      notes: dto.notes ?? null,
    });

    const orderItems = built.items.map((item) => ({
      order_id: invoice.id,
      tenant_id: tenant.tenantId,
      item_id: item.item_id,
      item_name: item.item_name,
      variant_id: item.variant_id ?? null,
      variant_name: item.variant_name ?? null,
      quantity: item.quantity,
      unit_price: item.unit_price,
      total_price: parseFloat((item.unit_price * item.quantity).toFixed(2)),
    }));

    await this.repo.insertItems(orderItems);

    await this.auditService.log({
      tenant_id: tenant.tenantId,
      actor_id: cashierId,
      actor_role: actorRole,
      action: 'invoice.create',
      resource_type: 'invoice',
      resource_id: invoice.id,
      after_data: { total: built.total, payment_method: dto.payment_method },
      ip_address: ip,
      device,
    });

    this.metricsService.recordInvoice(tenant.tenantId, 'completed');

    return { id: invoice.id, total: built.total };
  }

  async findAll(tenant: TenantContext, branchId?: string) {
    return this.repo.findAll(tenant, branchId);
  }

  async findById(tenant: TenantContext, id: string) {
    const invoice = await this.repo.findById(tenant, id);
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }

  async cancel(
    tenant: TenantContext,
    id: string,
    dto: CancelInvoiceDto,
    actorId: string,
    actorRole: string,
    ip: string,
    device: string,
  ) {
    const before = await this.findById(tenant, id);

    if (before.status === 'cancelled') {
      throw new BadRequestException('Invoice already cancelled');
    }

    const updated = await this.repo.cancel(tenant, id, actorId);

    if (!updated) {
      throw new BadRequestException('Cannot cancel this invoice');
    }

    await this.auditService.log({
      tenant_id: tenant.tenantId,
      actor_id: actorId,
      actor_role: actorRole,
      action: 'invoice.cancel',
      resource_type: 'invoice',
      resource_id: id,
      before_data: { status: before.status, total: before.total },
      after_data: { status: 'cancelled', reason: dto.reason },
      ip_address: ip,
      device,
    });

    this.metricsService.recordInvoice(tenant.tenantId, 'cancelled');

    return { id, status: 'cancelled' };
  }
}