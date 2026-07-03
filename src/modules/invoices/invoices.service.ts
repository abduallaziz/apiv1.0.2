import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PaginationDto } from '../../shared/dto/pagination.dto';
import { RedisCacheService } from '../../core/cache/redis-cache.service';
import { InvoicesRepository } from './repositories/invoices.repository';
import { PosEngine } from '../../engines/pos-engine/pos.engine';
import { PaymentEngine } from '../../engines/payment-engine/payment.engine';
import { AuditService } from '../../core/audit/audit.service';
import { MetricsService } from '../../core/metrics/metrics.service';
import { TenantsRepository } from '../tenants/repositories/tenants.repository';
import { LoyaltyService } from '../../core/loyalty/loyalty.service';
import { NotificationService } from '../../core/notification/notification.service';
import {
  NOTIFICATION_TYPES,
  NOTIFICATION_CHANNELS,
} from '../../core/notification/notification.constants';
import { TenantContext } from '../../core/tenant/tenant-context';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { CancelInvoiceDto } from './dto/cancel-invoice.dto';

const INVOICES_LIST_TTL = 240; // 4 minutes
const invoicesListCacheKey = (
  tenantId: string,
  branchId: string | undefined,
  dateFrom: string | undefined,
  dateTo: string | undefined,
  status: string | undefined,
  page: number,
  perPage: number,
) =>
  `invoices:list:tenant:${tenantId}:branch:${branchId ?? 'all'}:from:${dateFrom ?? 'any'}:to:${dateTo ?? 'any'}:status:${status ?? 'all'}:page:${page}:perPage:${perPage}`;

@Injectable()
export class InvoicesService {
  constructor(
    private readonly repo: InvoicesRepository,
    private readonly posEngine: PosEngine,
    private readonly paymentEngine: PaymentEngine,
    private readonly auditService: AuditService,
    private readonly metricsService: MetricsService,
    private readonly tenantsRepo: TenantsRepository,
    private readonly loyaltyService: LoyaltyService,
    private readonly notificationService: NotificationService,
    private readonly cache: RedisCacheService,
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
    const taxRate = tenant.tenantId
      ? await this.tenantsRepo.getTaxRate(tenant.tenantId)
      : 0;

    const loyaltySettings = await this.loyaltyService.getSettings(tenant.tenantId);

    let loyaltyDiscountAmount = 0;
    if (dto.redeem_points) {
      if (!dto.customer_id) {
        throw new BadRequestException(
          'customer_id required to redeem loyalty points',
        );
      }
      const balance = await this.loyaltyService.getBalance(dto.customer_id);
      if (balance < dto.redeem_points) {
        throw new BadRequestException('Insufficient loyalty points balance');
      }
      loyaltyDiscountAmount = this.loyaltyService.calculateRedemptionValue(
        dto.redeem_points,
        loyaltySettings,
      );
    }

    const manualBuilt = this.posEngine.buildInvoice(dto.items, dto.discount, taxRate);
    const combinedDiscountAmount = Math.min(
      manualBuilt.discount_amount + loyaltyDiscountAmount,
      manualBuilt.subtotal,
    );
    const taxAmount = this.posEngine.applyTax(manualBuilt.subtotal, combinedDiscountAmount, taxRate);
    const built = {
      items: manualBuilt.items,
      subtotal: manualBuilt.subtotal,
      discount_amount: combinedDiscountAmount,
      tax_amount: taxAmount,
      total: this.posEngine.calculateTotal(manualBuilt.subtotal, combinedDiscountAmount, taxAmount),
    };

    if (dto.payment_method === 'cash') {
      if (!dto.cash_tendered) {
        throw new BadRequestException(
          'cash_tendered required for cash payment',
        );
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
    } else if (dto.payment_method === 'tab' && !dto.customer_id) {
      throw new BadRequestException(
        'customer_id required for tab (open account) payment',
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

    await this.repo.insertItems(
      built.items.map((item) => ({
        order_id: invoice.id,
        tenant_id: tenant.tenantId,
        item_id: item.item_id,
        item_name: item.item_name,
        variant_id: item.variant_id ?? null,
        variant_name: item.variant_name ?? null,
        quantity: item.quantity,
        unit_price: item.unit_price,
        total_price: parseFloat((item.unit_price * item.quantity).toFixed(2)),
      })),
    );

    await this.auditService.log({
      tenant_id: tenant.tenantId,
      actor_id: cashierId,
      actor_role: actorRole,
      action: 'invoice.create',
      resource_type: 'invoice',
      resource_id: invoice.id,
      after_data: {
        total: built.total,
        payment_method: dto.payment_method,
        tax_rate: taxRate,
      },
      ip_address: ip,
      device,
    });

    this.metricsService.recordInvoice(tenant.tenantId, 'completed');

    if (dto.customer_id) {
      if (dto.redeem_points) {
        await this.loyaltyService.redeemPoints(dto.customer_id, dto.redeem_points);
      }
      // نقاط الولاء تُحتسب على المبلغ الفعلي المدفوع (بعد أي خصم، بما فيه استرداد النقاط)
      // لمنع "إعادة تدوير" النقاط (شراء نقاط جديدة بنقاط سابقة)
      const pointsEarned = this.loyaltyService.calculatePointsEarned(built.total, loyaltySettings);
      this.loyaltyService.awardPoints(dto.customer_id, pointsEarned).catch(() => {});
    }

    // إشعار داخلي للكاشير عند إتمام الفاتورة
    this.notificationService
      .notify({
        userId: cashierId,
        tenantId: tenant.tenantId,
        type: NOTIFICATION_TYPES.PAYMENT_SUCCESS,
        channels: [NOTIFICATION_CHANNELS.IN_APP],
        data: { total: built.total, invoice_id: invoice.id },
      })
      .catch(() => {}); // لا نوقف العملية إذا فشل الإشعار

    await this.invalidateList(tenant.tenantId);

    return { id: invoice.id, total: built.total, tax_rate: taxRate };
  }

  async findAll(
    tenant: TenantContext,
    branchId?: string,
    dateFrom?: string,
    dateTo?: string,
    page?: string,
    perPage?: string,
    status?: string,
  ) {
    const pagination = new PaginationDto(page, perPage);
    const cacheKey = invoicesListCacheKey(
      tenant.tenantId,
      branchId,
      dateFrom,
      dateTo,
      status,
      pagination.page,
      pagination.perPage,
    );

    const cached = await this.cache.get<Awaited<ReturnType<InvoicesRepository['findAll']>>>(cacheKey);
    if (cached) return cached;

    const data = await this.repo.findAll(tenant, branchId, dateFrom, dateTo, pagination, status);
    await this.cache.set(cacheKey, data, INVOICES_LIST_TTL);
    return data;
  }

  private async invalidateList(tenantId: string): Promise<void> {
    await this.cache.delByPrefix(`invoices:list:tenant:${tenantId}:`);
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

    await this.invalidateList(tenant.tenantId);

    return { id, status: 'cancelled' };
  }
}
