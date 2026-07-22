import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaginationDto } from '../../shared/dto/pagination.dto';
import { RedisCacheService } from '../../core/cache/redis-cache.service';
import { InvoicesRepository } from './repositories/invoices.repository';
import { PosEngine } from '../../engines/pos-engine/pos.engine';
import { PaymentEngine } from '../../engines/payment-engine/payment.engine';
import { AuditService } from '../../core/audit/audit.service';
import { MetricsService } from '../../core/metrics/metrics.service';
import { TenantsRepository } from '../tenants/repositories/tenants.repository';
import { LoyaltyService } from '../../core/loyalty/loyalty.service';
import { CouponsService, Coupon } from '../coupons/coupons.service';
import { GiftCardsService, GiftCard } from '../gift-cards/gift-cards.service';
import { CustomersService } from '../customers/customers.service';
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
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private readonly repo: InvoicesRepository,
    private readonly posEngine: PosEngine,
    private readonly paymentEngine: PaymentEngine,
    private readonly auditService: AuditService,
    private readonly metricsService: MetricsService,
    private readonly tenantsRepo: TenantsRepository,
    private readonly loyaltyService: LoyaltyService,
    private readonly couponsService: CouponsService,
    private readonly giftCardsService: GiftCardsService,
    private readonly customersService: CustomersService,
    private readonly notificationService: NotificationService,
    private readonly cache: RedisCacheService,
    private readonly config: ConfigService,
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
    // ثلاثة استعلامات مستقلة تمامًا عن بعضها (فحص ملكية العميل، نسبة الضريبة، إعدادات
    // الولاء) — كانت تُنفَّذ بالتسلسل رغم عدم اعتماد أي منها على نتيجة الآخر، فتضيف
    // زمن استجابة (round-trip) إضافيًا لكل عملية بيع واحدة. تُنفَّذ الآن بالتوازي.
    const [, taxRate, loyaltySettings] = await Promise.all([
      dto.customer_id
        ? this.customersService.findById(tenant, dto.customer_id)
        : Promise.resolve(null),
      tenant.tenantId
        ? this.tenantsRepo.getTaxRate(tenant.tenantId)
        : Promise.resolve(0),
      this.loyaltyService.getSettings(tenant.tenantId),
    ]);

    let loyaltyDiscountAmount = 0;
    if (dto.redeem_points) {
      if (!loyaltySettings.enabled) {
        throw new BadRequestException(
          'Loyalty program is disabled for this tenant',
        );
      }
      if (!dto.customer_id) {
        throw new BadRequestException(
          'customer_id required to redeem loyalty points',
        );
      }
      const balance = this.config.get<boolean>('POOLED_LOYALTY_WRITES_ENABLED')
        ? await this.loyaltyService.getBalancePooled(
            tenant.tenantId,
            dto.customer_id,
          )
        : await this.loyaltyService.getBalance(
            tenant.tenantId,
            dto.customer_id,
          );
      if (balance < dto.redeem_points) {
        throw new BadRequestException('Insufficient loyalty points balance');
      }
      loyaltyDiscountAmount = this.loyaltyService.calculateRedemptionValue(
        dto.redeem_points,
        loyaltySettings,
      );
    }

    const manualBuilt = this.posEngine.buildInvoice(
      dto.items,
      dto.discount,
      taxRate,
    );

    let couponDiscountAmount = 0;
    let coupon: Coupon | null = null;
    if (dto.coupon_code) {
      coupon = await this.couponsService.validate(
        tenant,
        dto.coupon_code,
        manualBuilt.subtotal,
      );
      couponDiscountAmount = this.couponsService.calculateDiscount(
        coupon,
        manualBuilt.subtotal,
      );
    }

    const combinedDiscountAmount = Math.min(
      manualBuilt.discount_amount +
        loyaltyDiscountAmount +
        couponDiscountAmount,
      manualBuilt.subtotal,
    );
    const taxAmount = this.posEngine.applyTax(
      manualBuilt.subtotal,
      combinedDiscountAmount,
      taxRate,
    );
    const built = {
      items: manualBuilt.items,
      subtotal: manualBuilt.subtotal,
      discount_amount: combinedDiscountAmount,
      tax_amount: taxAmount,
      total: this.posEngine.calculateTotal(
        manualBuilt.subtotal,
        combinedDiscountAmount,
        taxAmount,
      ),
    };

    // بطاقة الهدايا تسدّد جزءًا أو كامل الفاتورة مباشرة (رصيد مخزَّن حقيقي) — بخلاف
    // الكوبون/نقاط الولاء (خصم يقلّل المبلغ)، فهي لا تدخل بحساب discount_amount إطلاقًا.
    // ما تبقّى بعدها هو ما تُحقَّق عليه طريقة الدفع المختارة (dto.payment_method).
    let giftCard: GiftCard | null = null;
    let giftCardAmount = 0;
    if (dto.gift_card_code) {
      if (!dto.gift_card_amount) {
        throw new BadRequestException(
          'gift_card_amount required when gift_card_code is provided',
        );
      }
      giftCard = await this.giftCardsService.validate(
        tenant,
        dto.gift_card_code,
        dto.gift_card_amount,
      );
      giftCardAmount = Math.min(dto.gift_card_amount, built.total);
    }
    const amountDueAfterGiftCard = parseFloat(
      (built.total - giftCardAmount).toFixed(2),
    );

    // A gift card that covers the entire total means no cash/card/etc. ever
    // actually changed hands — whatever payment_method the frontend happened
    // to have selected (defaults to 'cash') is a leftover UI selection, not a
    // real payment. Overriding it here (not trusting the client) is the only
    // honest thing to store — matches the same "server is source of truth"
    // reasoning already applied to gift_card_amount/coupon discounts above.
    const storedPaymentMethod =
      amountDueAfterGiftCard <= 0 ? 'gift_card' : dto.payment_method;

    if (amountDueAfterGiftCard > 0) {
      if (dto.payment_method === 'cash') {
        if (!dto.cash_tendered) {
          throw new BadRequestException(
            'cash_tendered required for cash payment',
          );
        }
        this.paymentEngine.processCashPayment(
          amountDueAfterGiftCard,
          dto.cash_tendered,
        );
      } else if (dto.payment_method === 'split') {
        if (dto.cash_amount === undefined || dto.card_amount === undefined) {
          throw new BadRequestException(
            'cash_amount and card_amount required for split payment',
          );
        }
        this.paymentEngine.processSplitPayment(
          amountDueAfterGiftCard,
          dto.cash_amount,
          dto.card_amount,
        );
      } else if (dto.payment_method === 'tab' && !dto.customer_id) {
        throw new BadRequestException(
          'customer_id required for tab (open account) payment',
        );
      }
    }

    // نقطة الاسترداد الفعلية (الذرّية، القابلة للرمي) تصير هنا عمدًا — بعد كل تحقق آخر
    // ممكن يفشل (كوبون/بطاقة هدايا/طريقة الدفع) لكن قبل إنشاء الفاتورة مباشرة. لو صارت
    // مبكرًا (وقت حساب loyaltyDiscountAmount أعلاه) وفشل تحقق لاحق، كانت النقاط تُخصَم فعليًا
    // دون إنشاء أي فاتورة. ولو صارت متأخرة (بعد repo.create كما كانت سابقًا)، كان يحصل العكس:
    // الفاتورة تُنشأ فعليًا وتُطبَّق الخصم على إجماليها، ثم لو فشل الاسترداد الذرّي (تغيّر
    // الرصيد فعليًا بين الفحص المبكر أعلاه وهذه اللحظة) يفشل الطلب لكن الفاتورة تبقى محفوظة.
    // هذا هو أقرب موضع ممكن لعملية الإنشاء الفعلية مع إبقاء الاسترداد قبلها لا بعدها.
    if (dto.redeem_points) {
      if (this.config.get<boolean>('POOLED_LOYALTY_WRITES_ENABLED')) {
        await this.loyaltyService.redeemPointsPooled(
          tenant.tenantId,
          dto.customer_id,
          dto.redeem_points,
        );
      } else {
        await this.loyaltyService.redeemPoints(
          tenant.tenantId,
          dto.customer_id,
          dto.redeem_points,
        );
      }
    }

    // Feature-flagged, defaults to false everywhere until DATABASE_URL is
    // provisioned and migration 075 applied (see STATUS.md §78/§79,
    // TASKS.md "SAFETY & SCALE INITIATIVE"). Do not remove the PostgREST
    // branch when enabling this — it's not a temporary shim, it's what every
    // repository not yet migrated onto TenantSessionService still relies on.
    const usePooledWrite = this.config.get<boolean>(
      'POOLED_INVOICE_WRITES_ENABLED',
    );

    let invoice: { id: string };
    if (usePooledWrite) {
      invoice = await this.repo.createWithItemsPooled(
        tenant,
        {
          branch_id: branchId,
          cashier_id: cashierId,
          customer_id: dto.customer_id ?? null,
          status: 'completed',
          subtotal: built.subtotal,
          discount: built.discount_amount,
          tax: built.tax_amount,
          total: built.total,
          payment_method: storedPaymentMethod,
          notes: dto.notes ?? null,
          coupon_code: coupon?.code ?? null,
          gift_card_code: giftCard?.code ?? null,
          gift_card_amount: giftCard ? giftCardAmount : null,
        },
        built.items,
      );
    } else {
      invoice = await this.repo.create(tenant, {
        branch_id: branchId,
        cashier_id: cashierId,
        customer_id: dto.customer_id ?? null,
        status: 'completed',
        subtotal: built.subtotal,
        discount: built.discount_amount,
        tax: built.tax_amount,
        total: built.total,
        payment_method: storedPaymentMethod,
        notes: dto.notes ?? null,
        coupon_code: coupon?.code ?? null,
        gift_card_code: giftCard?.code ?? null,
        gift_card_amount: giftCard ? giftCardAmount : null,
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
    }

    await this.auditService.log({
      tenant_id: tenant.tenantId,
      actor_id: cashierId,
      actor_role: actorRole,
      action: 'invoice.create',
      resource_type: 'invoice',
      resource_id: invoice.id,
      after_data: {
        total: built.total,
        payment_method: storedPaymentMethod,
        tax_rate: taxRate,
      },
      ip_address: ip,
      device,
    });

    this.metricsService.recordInvoice(tenant.tenantId, 'completed');

    if (coupon) {
      await this.couponsService.redeem(coupon.id, invoice.id);
    }
    if (giftCard) {
      await this.giftCardsService.redeem(
        giftCard.id,
        giftCardAmount,
        invoice.id,
      );
    }

    // خصم المخزون: أفضل-محاولة (best-effort) — مشكلة بالمخزون لا توقف بيعًا مكتمِلًا أبدًا
    // (قرار منتج صريح، راجع STATUS.md §64)، لكنها لم تعد تُبتلَع بصمت: أي فشل هنا يُسجَّل،
    // يُرسَل كإشعار داخلي للكاشير، ويُرجَع صراحةً في استجابة الـ API (stock_warning) بدل ما
    // يظل غير مرئي إلا في سجلات السيرفر. يُخصَم فقط إن كان للفرع مستودع افتراضي معيَّن
    // (default_warehouse_id)، وفقط للعناصر المُتتبَّعة فعليًا بالمخزون (items.has_inventory).
    let stockWarning: string | null = null;
    const warehouseId = await this.repo.getBranchDefaultWarehouse(branchId);
    if (warehouseId) {
      try {
        await this.repo.deductStockForSale(
          tenant.tenantId,
          warehouseId,
          invoice.id,
          cashierId,
          built.items.map((item) => ({
            item_id: item.item_id,
            variant_id: item.variant_id ?? null,
            quantity: item.quantity,
          })),
        );
      } catch (err) {
        // The repo throws Supabase's raw PostgrestError ({message, details,
        // hint, code}) rather than a real Error instance for RPC failures,
        // so `err instanceof Error` is false and `String(err)` degrades to
        // "[object Object]" — extract .message explicitly instead.
        const message =
          err && typeof err === 'object' && 'message' in err
            ? String((err as { message: unknown }).message)
            : String(err);
        this.logger.warn(
          `Stock deduction failed for invoice ${invoice.id} (warehouse ${warehouseId}): ${message}`,
        );
        stockWarning = message;
        this.notificationService
          .notify({
            userId: cashierId,
            tenantId: tenant.tenantId,
            type: NOTIFICATION_TYPES.INVENTORY_STOCK_DEDUCTION_FAILED,
            channels: [NOTIFICATION_CHANNELS.IN_APP],
            data: {
              invoice_id: invoice.id,
              warehouse_id: warehouseId,
              error: message,
            },
          })
          .catch(() => {}); // الإشعار نفسه لا يجب أن يوقف الاستجابة لو فشل إرساله
      }
    }

    if (dto.customer_id && loyaltySettings.enabled) {
      // (استرداد نقاط الولاء المطلوب، لو طُلب، يكون قد صار فعليًا قبل إنشاء الفاتورة أعلاه)
      // نقاط الولاء تُحتسب على المبلغ الفعلي المدفوع (بعد أي خصم، بما فيه استرداد النقاط)
      // لمنع "إعادة تدوير" النقاط (شراء نقاط جديدة بنقاط سابقة)
      const basePoints = this.loyaltyService.calculatePointsEarned(
        built.total,
        loyaltySettings,
      );
      // مضاعِف الفئة (tier) يُحسَب على lifetime_points_earned *قبل* هذه العملية —
      // نفس فلسفة نقاط الولاء نفسها: من رصيده الحالي يمكن أن يهبط بالاسترداد، لكن
      // إجمالي ما اكتسبه لا ينخفض أبدًا، فالفئة لا تتذبذب صعودًا وهبوطًا مع كل عملية استرداد.
      const tierMultiplier = await this.loyaltyService.getTierMultiplier(
        tenant.tenantId,
        dto.customer_id,
      );
      const pointsEarned = Math.floor(basePoints * tierMultiplier);
      const awardCall = this.config.get<boolean>(
        'POOLED_LOYALTY_WRITES_ENABLED',
      )
        ? this.loyaltyService.awardPointsPooled(
            tenant.tenantId,
            dto.customer_id,
            pointsEarned,
          )
        : this.loyaltyService.awardPoints(
            tenant.tenantId,
            dto.customer_id,
            pointsEarned,
          );
      awardCall.catch(() => {});
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

    return {
      id: invoice.id,
      total: built.total,
      tax_rate: taxRate,
      stock_warning: stockWarning,
    };
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

    const cached =
      await this.cache.get<Awaited<ReturnType<InvoicesRepository['findAll']>>>(
        cacheKey,
      );
    if (cached) return cached;

    const data = await this.repo.findAll(
      tenant,
      branchId,
      dateFrom,
      dateTo,
      pagination,
      status,
    );
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

    // يعكس أي خصم مخزون تم فعليًا عند البيع (لا شيء إن لم يُخصَم أصلًا) — best-effort أيضًا
    this.repo
      .reverseSaleStockDeduction(tenant.tenantId, id, actorId)
      .catch((err) => {
        this.logger.warn(
          `Stock restock failed for cancelled invoice ${id}: ${err?.message ?? err}`,
        );
      });

    await this.invalidateList(tenant.tenantId);

    return { id, status: 'cancelled' };
  }
}
