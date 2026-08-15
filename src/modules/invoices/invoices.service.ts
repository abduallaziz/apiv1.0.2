import {
  Injectable,
  BadRequestException,
  ConflictException,
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
import { CustomersService } from '../customers/customers.service';
import { NotificationService } from '../../core/notification/notification.service';
import {
  NOTIFICATION_TYPES,
  NOTIFICATION_CHANNELS,
} from '../../core/notification/notification.constants';
import { TenantContext } from '../../core/tenant/tenant-context';
import { ShiftsService } from '../shifts/shifts.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { CancelInvoiceDto } from './dto/cancel-invoice.dto';
import { HoldOrderDto, HeldOrderVisibility } from './dto/hold-order.dto';
import { HoldsRepository } from '../quality/repositories/holds.repository';
import { OwnershipRepository } from '../ownership/repositories/ownership.repository';
import { ExpiredBatchesRepository } from '../inventory/repositories/expired-batches.repository';
import { SerialsRepository } from '../inventory/repositories/serials.repository';
import {
  PriceResolutionService,
  PriceResolutionResult,
} from '../../core/pricing/price-resolution.service';
import { EffectiveRole } from '../../core/pricing/effective-role.resolver';
import { PooledOverrideAudit } from './repositories/invoices.repository';
import { isUniqueViolation } from '../../shared/supabase/postgrest-error.util';

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
    private readonly customersService: CustomersService,
    private readonly notificationService: NotificationService,
    private readonly cache: RedisCacheService,
    private readonly config: ConfigService,
    private readonly shiftsService: ShiftsService,
    private readonly holdsRepo: HoldsRepository,
    private readonly ownershipRepo: OwnershipRepository,
    private readonly expiredBatchesRepo: ExpiredBatchesRepository,
    private readonly serialsRepo: SerialsRepository,
    private readonly priceResolutionService: PriceResolutionService,
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
    // M187 idempotency: checked before any other work (including the shift
    // check below) so a genuine resubmit — double-click, client retry,
    // second tab — with the SAME sale_attempt_id never re-runs loyalty
    // redemption, coupon redemption, or any other side effect a second
    // time. A different sale_attempt_id is always treated as a new sale.
    const existingAttempt = await this.repo.findBySaleAttemptId(
      tenant,
      dto.sale_attempt_id,
    );
    if (existingAttempt) {
      throw new ConflictException({
        message: 'This sale was already created',
        order_id: existingAttempt.id,
      });
    }

    // البيع ممنوع بلا جلسة صندوق مفتوحة — الحد المالي لكل بيع هو جلسة الصندوق النشطة،
    // وليس مجرد اختياريًا كما كان الحال. لازم يُفحَص هنا أولًا قبل أي عمل آخر (كوبون/بطاقة
    // هدايا/نقاط ولاء) حتى لا تُنفَّذ أي آثار جانبية لبيع سيُرفَض لاحقًا لعدم وجود جلسة.
    await this.shiftsService.assertOpenSession(tenant.tenantId, shiftId);

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

    // D01-M7 — resolve official price + Price Override decision for every
    // line BEFORE any subtotal/order/write work below. Replaces the
    // client-supplied dto.items[].unit_price in place with the server-
    // resolved official/approved price, so PosEngine (and everything after
    // it) never sees the raw client value again. Any single rejected line
    // aborts the whole invoice here — zero writes have started yet, which is
    // what makes "Item 1/2 approved, Item 3 rejected -> zero writes" true
    // without needing a transaction for this phase.
    //
    // Effective Role is resolved at most once per invoice (same userId for
    // every line) and reused across lines via the cache below — never
    // re-queried per line. A pure Normal Sale (every line requested ===
    // official) never triggers it at all, matching PriceResolutionService's
    // own no_override short-circuit.
    let cachedEffectiveRole: {
      resolved: boolean;
      role: EffectiveRole | null;
    } | null = null;
    let anyApprovedOverride = false;
    const priceResolutions: PriceResolutionResult[] = [];
    const hasInvoiceLevelDiscount = !!dto.discount;

    for (const item of dto.items) {
      const result = await this.priceResolutionService.resolvePrice({
        userId: cashierId,
        tenantId: tenant.tenantId,
        branchId,
        itemId: item.item_id,
        variantId: item.variant_id,
        requestedUnitPrice: item.unit_price,
        reason: item.reason,
        hasInvoiceLevelDiscount,
        effectiveRole: cachedEffectiveRole?.resolved
          ? cachedEffectiveRole.role
          : undefined,
      });

      if (result.kind === 'approved') {
        if (!cachedEffectiveRole) {
          cachedEffectiveRole = { resolved: true, role: result.effectiveRole };
        }
        anyApprovedOverride = true;
      } else if (result.kind === 'rejected') {
        if (
          !cachedEffectiveRole &&
          result.resolvedEffectiveRole !== undefined
        ) {
          cachedEffectiveRole = {
            resolved: true,
            role: result.resolvedEffectiveRole,
          };
        }
        if (result.reasonCode === 'item_or_variant_not_found') {
          throw new NotFoundException({
            message: 'Item or variant not found',
            item_id: item.item_id,
            reasonCode: result.reasonCode,
          });
        }
        throw new BadRequestException({
          message: 'Price override rejected',
          item_id: item.item_id,
          reasonCode: result.reasonCode,
        });
      }

      priceResolutions.push(result);
      // Replace the client-supplied price with the server-resolved one —
      // official for a Normal Sale, approved for an Override. Every
      // downstream consumer (PosEngine, order_items insert) reads this
      // mutated value, never the original client input again.
      item.unit_price =
        result.kind === 'no_override'
          ? result.officialUnitPrice
          : result.approvedUnitPrice;
    }

    // Feature-flagged, defaults to false everywhere until DATABASE_URL is
    // provisioned and migration 075 applied (see STATUS.md §78/§79,
    // TASKS.md "SAFETY & SCALE INITIATIVE"). Do not remove the PostgREST
    // branch when enabling this — it's not a temporary shim, it's what every
    // repository not yet migrated onto TenantSessionService still relies on.
    const usePooledWrite = this.config.get<boolean>(
      'POOLED_INVOICE_WRITES_ENABLED',
    );

    // D01-M7 — an approved Price Override can only be committed atomically
    // with its price_override_audit row, which only the pooled transaction
    // path (createWithItemsPooled) provides. Reject before any write rather
    // than risk an override landing without its audit row.
    if (anyApprovedOverride && !usePooledWrite) {
      throw new BadRequestException({
        message:
          'Price override requires the atomic (pooled) write path, which is not enabled',
        reasonCode: 'price_override_requires_atomic_write_path',
      });
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

    const storedPaymentMethod = dto.payment_method;

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
      // M188 persistence guard: processSplitPayment above only checks the
      // split covers the total (allowing an overpay/"change" scenario it
      // was originally designed for). What gets PERSISTED must reconcile
      // exactly — no negative component, no overpayment — since these
      // values, once stored, are what a future accounting/shift-
      // reconciliation migration will trust as the real breakdown. Mirrors
      // the same DB-level CHECK added in migration 188 (defense in depth).
      if (dto.cash_amount < 0 || dto.card_amount < 0) {
        throw new BadRequestException(
          'cash_amount and card_amount must not be negative',
        );
      }
      const splitSum = parseFloat(
        (dto.cash_amount + dto.card_amount).toFixed(2),
      );
      if (splitSum !== built.total) {
        throw new BadRequestException(
          `cash_amount + card_amount (${splitSum}) must equal the payable amount (${built.total}) exactly`,
        );
      }
    } else if (dto.payment_method === 'tab' && !dto.customer_id) {
      throw new BadRequestException(
        'customer_id required for tab (open account) payment',
      );
    }

    // M188: the persisted breakdown is derived here, once, strictly from
    // server-validated values — never a raw pass-through of dto.cash_amount/
    // dto.card_amount for non-split methods, so a client cannot smuggle a
    // breakdown onto a cash/card/tab/etc. order by sending those fields
    // anyway (requirement: cannot bypass split validation via persisted
    // values). Both null together for every method except 'split'.
    const persistedCashAmount =
      dto.payment_method === 'split' ? dto.cash_amount : null;
    const persistedCardAmount =
      dto.payment_method === 'split' ? dto.card_amount : null;

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

    let invoice: { id: string };
    try {
      if (usePooledWrite) {
        // D01-M7 — official_price_snapshot and, for approved-override
        // lines, the full audit payload (built entirely from M6's own
        // returned values — nothing recomputed here) are attached per line
        // so createWithItemsPooled can write order_items and
        // price_override_audit inside the same BEGIN/COMMIT.
        const pooledItems = built.items.map((item, i) => {
          const resolution = priceResolutions[i];
          const override: PooledOverrideAudit | undefined =
            resolution.kind === 'approved'
              ? {
                  actor_role_id: resolution.effectiveRole.roleId,
                  actor_role_name_snapshot: resolution.effectiveRole.roleName,
                  official_unit_price: resolution.officialUnitPrice,
                  approved_unit_price: resolution.approvedUnitPrice,
                  difference_amount: resolution.differenceAmount,
                  difference_percent: resolution.differencePercent,
                  direction: resolution.direction,
                  reason: resolution.reason,
                  effective_policy_snapshot: resolution.effectivePolicySnapshot,
                }
              : undefined;
          return {
            ...item,
            official_price_snapshot: resolution.officialUnitPrice,
            override,
          };
        });

        invoice = await this.repo.createWithItemsPooled(
          tenant,
          {
            branch_id: branchId,
            shift_id: shiftId,
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
            sale_attempt_id: dto.sale_attempt_id,
            cash_amount: persistedCashAmount,
            card_amount: persistedCardAmount,
          },
          pooledItems,
        );
      } else {
        invoice = await this.repo.create(tenant, {
          branch_id: branchId,
          shift_id: shiftId,
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
          sale_attempt_id: dto.sale_attempt_id,
          cash_amount: persistedCashAmount,
          card_amount: persistedCardAmount,
        });

        // D01-M7 — official_price_snapshot per line (Normal Sale only can
        // reach this branch; anyApprovedOverride forced usePooledWrite above).
        await this.repo.insertItems(
          built.items.map((item, i) => ({
            order_id: invoice.id,
            tenant_id: tenant.tenantId,
            item_id: item.item_id,
            item_name: item.item_name,
            variant_id: item.variant_id ?? null,
            variant_name: item.variant_name ?? null,
            quantity: item.quantity,
            unit_price: item.unit_price,
            official_price_snapshot: priceResolutions[i].officialUnitPrice,
            total_price: parseFloat(
              (item.unit_price * item.quantity).toFixed(2),
            ),
          })),
        );
      }
    } catch (err: any) {
      // Race backstop for M187: two concurrent requests with the same
      // sale_attempt_id can both pass the early check above before either
      // commits. uq_orders_tenant_sale_attempt (migration 187) is the real
      // guarantee — the loser hits a unique-violation (Postgres 23505) here
      // and resolves to the winner's order instead of erroring blindly.
      if (isUniqueViolation(err)) {
        const existing = await this.repo.findBySaleAttemptId(
          tenant,
          dto.sale_attempt_id,
        );
        if (existing) {
          throw new ConflictException({
            message: 'This sale was already created',
            order_id: existing.id,
          });
        }
      }
      // M184 — fn_post_sales_order() failures (missing branch assignment,
      // closed fiscal period, unrecognized payment method, missing
      // account role, unbalanced totals) surface here as plain Postgres
      // errors from the same transaction that already rolled back the
      // order/order_items/audit. Converted to the existing HTTP
      // convention rather than leaking a raw 500 — the underlying
      // rollback already happened either way; this only shapes the
      // response.
      if (
        typeof err?.message === 'string' &&
        /accounting owner|accounting book|no account assigned|already been posted to accounting|unrecognized payment_method|no cash_amount\/card_amount|totals do not reconcile|fiscal period/i.test(
          err.message,
        )
      ) {
        throw new BadRequestException({
          message: 'Accounting posting failed — sale was not created',
          reasonCode: 'accounting_posting_failed',
          detail: err.message,
        });
      }
      throw err;
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

    // خصم المخزون: أفضل-محاولة (best-effort) — مشكلة بالمخزون لا توقف بيعًا مكتمِلًا أبدًا
    // (قرار منتج صريح، راجع STATUS.md §64)، لكنها لم تعد تُبتلَع بصمت: أي فشل هنا يُسجَّل،
    // يُرسَل كإشعار داخلي للكاشير، ويُرجَع صراحةً في استجابة الـ API (stock_warning) بدل ما
    // يظل غير مرئي إلا في سجلات السيرفر. يُخصَم فقط إن كان للفرع مستودع افتراضي معيَّن
    // (default_warehouse_id)، وفقط للعناصر المُتتبَّعة فعليًا بالمخزون (items.has_inventory).
    let stockWarning: string | null = null;
    const warehouseId = await this.repo.getBranchDefaultWarehouse(branchId);
    if (warehouseId) {
      // Advisory-only quality hold check (Migration 8.2, #19) — purely
      // informational, contributes to the same stock_warning field the
      // deduction failure path already uses below. Never throws, never
      // blocks, and runs strictly BEFORE deductStockForSale() without
      // altering that call, fn_process_sale_stock_deduction, or
      // fn_apply_stock_movement in any way — the sale always proceeds
      // identically regardless of what this check finds.
      try {
        const heldItems = await this.holdsRepo.checkHolds(
          tenant.tenantId,
          warehouseId,
          built.items.map((item) => ({
            item_id: item.item_id,
            variant_id: item.variant_id ?? null,
          })),
        );
        if (heldItems && heldItems.length > 0) {
          const names = [
            ...new Set(heldItems.map((h: any) => h.item_name)),
          ].join(', ');
          stockWarning = `Sold item(s) under active quality hold: ${names}`;
        }
      } catch (err) {
        // Quality hold lookup itself failing must never affect the sale —
        // log and continue exactly as if no holds existed.
        this.logger.warn(
          `Quality hold check failed for invoice ${invoice.id} (warehouse ${warehouseId}): ${
            err && typeof err === 'object' && 'message' in err
              ? String((err as { message: unknown }).message)
              : String(err)
          }`,
        );
      }

      // Advisory-only expired-batch check (Migration 13.13-fix, #13) —
      // purely informational, contributes to the same stock_warning field.
      // Never throws, never blocks, runs strictly BEFORE
      // deductStockForSale() without altering that call,
      // fn_process_sale_stock_deduction, fn_consume_cost_layers, or its
      // FEFO ordering in any way — the sale always proceeds identically
      // regardless of what this check finds. Mirrors the Quality Hold
      // check above exactly (same non-blocking pattern, same
      // append-to-stockWarning behavior).
      try {
        const expiredBatches =
          await this.expiredBatchesRepo.checkExpiredBatches(
            tenant.tenantId,
            warehouseId,
            built.items.map((item) => ({
              item_id: item.item_id,
              variant_id: item.variant_id ?? null,
            })),
          );
        if (expiredBatches && expiredBatches.length > 0) {
          const names = [
            ...new Set(expiredBatches.map((b: any) => b.item_name)),
          ].join(', ');
          const expiredBatchWarning = `Sold item(s) with expired batch stock: ${names}`;
          stockWarning = [stockWarning, expiredBatchWarning]
            .filter(Boolean)
            .join(' | ');
        }
      } catch (err) {
        // Expired-batch lookup itself failing must never affect the sale —
        // log and continue exactly as if no expired batches existed.
        this.logger.warn(
          `Expired batch check failed for invoice ${invoice.id} (warehouse ${warehouseId}): ${
            err && typeof err === 'object' && 'message' in err
              ? String((err as { message: unknown }).message)
              : String(err)
          }`,
        );
      }

      // Advisory-only ownership layer consumption (Migration 10.1, #20) —
      // bookkeeping only: reduces any active stock_ownership_layers for the
      // sold items (company-owned items have no layer, so this is a no-op
      // for the overwhelming majority of sales). Never throws in a way that
      // affects the sale, never touches stock_levels/cost_layers/
      // stock_movements/fn_apply_stock_movement — those are handled
      // identically to before by the unchanged deductStockForSale() call
      // below, regardless of what happens here.
      try {
        const ownedItemNames: string[] = [];
        for (const item of built.items) {
          const consumed = await this.ownershipRepo.consumeForSale(
            tenant.tenantId,
            warehouseId,
            item.item_id,
            item.variant_id ?? null,
            item.quantity,
          );
          if (consumed > 0) {
            ownedItemNames.push(item.item_name ?? item.item_id);
          }
        }
        if (ownedItemNames.length > 0) {
          const names = [...new Set(ownedItemNames)].join(', ');
          const ownershipWarning = `Sold item(s) held under non-company ownership: ${names}`;
          stockWarning = [stockWarning, ownershipWarning]
            .filter(Boolean)
            .join(' | ');
        }
      } catch (err) {
        // Ownership consumption itself failing must never affect the sale —
        // log and continue exactly as if no ownership layers existed.
        this.logger.warn(
          `Ownership layer consumption failed for invoice ${invoice.id} (warehouse ${warehouseId}): ${
            err && typeof err === 'object' && 'message' in err
              ? String((err as { message: unknown }).message)
              : String(err)
          }`,
        );
      }

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
        // Append rather than overwrite — a quality-hold advisory may have
        // already been set above; both are independent, non-blocking
        // signals about the same sale and neither should hide the other.
        stockWarning = [stockWarning, message].filter(Boolean).join(' | ');
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

    // Serial sale transition (Migration 13.14 Phase 3, #14) — only for
    // lines that explicitly carry a serial_id (normal, non-serialized
    // sales have none and this loop is a no-op for them, per approved
    // scope). fn_sell_serial doesn't need a warehouse, so this runs
    // independent of the default_warehouse_id gate above. Best-effort,
    // same non-blocking pattern as every other advisory/bookkeeping step
    // in this method — a failed transition is logged and appended to
    // stock_warning, never thrown, and never affects invoice completion.
    for (const item of built.items as ((typeof built.items)[number] & {
      serial_id?: string;
      warranty_months?: number;
    })[]) {
      if (!item.serial_id) continue;
      try {
        await this.serialsRepo.sell(
          item.serial_id,
          invoice.id,
          item.warranty_months ?? null,
        );
      } catch (err) {
        const message =
          err && typeof err === 'object' && 'message' in err
            ? String((err as { message: unknown }).message)
            : String(err);
        this.logger.warn(
          `Serial sale transition failed for invoice ${invoice.id} (serial ${item.serial_id}): ${message}`,
        );
        stockWarning = [stockWarning, `Serial ${item.serial_id}: ${message}`]
          .filter(Boolean)
          .join(' | ');
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

    // M184 — reversal can only be attempted atomically with the status
    // change via the pooled path, mirroring create()'s own gating: a
    // sale can only ever have been posted to Accounting in the first
    // place when POOLED_INVOICE_WRITES_ENABLED was true, so when it's
    // false today there is, by construction, never anything to reverse.
    const usePooledCancel = this.config.get<boolean>(
      'POOLED_INVOICE_WRITES_ENABLED',
    );
    const updated = usePooledCancel
      ? await this.repo.cancelPooled(tenant, id, actorId)
      : await this.repo.cancel(tenant, id, actorId);

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

    // Serial return transition (Migration 13.14 Phase 3, #14) — restores
    // any serials sold under this invoice (sold -> returned, via the
    // existing, unmodified fn_return_serial). Best-effort, same pattern as
    // the stock-restock call above: a failure here must never block the
    // cancellation itself. A no-op for invoices with no serialized lines.
    this.serialsRepo
      .findSoldByOrder(id, tenant.tenantId)
      .then((soldSerials) =>
        Promise.all(
          (soldSerials ?? []).map((s: { id: string }) =>
            this.serialsRepo.returnSerial(s.id).catch((err) => {
              this.logger.warn(
                `Serial return transition failed for cancelled invoice ${id} (serial ${s.id}): ${err?.message ?? err}`,
              );
            }),
          ),
        ),
      )
      .catch((err) => {
        this.logger.warn(
          `Serial lookup failed for cancelled invoice ${id}: ${err?.message ?? err}`,
        );
      });

    await this.invalidateList(tenant.tenantId);

    return { id, status: 'cancelled' };
  }

  // Held orders — deliberately isolated from create() above: no payment,
  // no stock deduction, no coupon/loyalty processing. A held
  // order becomes a real sale only when its items are loaded back into an
  // active cart and checked out through the normal create() flow, which
  // this section never touches.
  async holdOrder(
    tenant: TenantContext,
    dto: HoldOrderDto,
    actorId: string,
    actorRole: string,
  ) {
    const subtotal = dto.items.reduce(
      (sum, item) => sum + Number(item.quantity) * Number(item.unit_price),
      0,
    );

    const order = await this.repo.create(tenant, {
      branch_id: dto.branch_id,
      shift_id: dto.shift_id ?? null,
      cashier_id: actorId,
      customer_id: dto.customer_id ?? null,
      status: 'pending',
      subtotal,
      discount: 0,
      tax: 0,
      total: subtotal,
      notes: dto.notes ?? null,
      held: true,
      held_visibility: dto.held_visibility ?? HeldOrderVisibility.SELF,
      held_by: actorId,
      held_at: new Date().toISOString(),
    });

    await this.repo.insertItems(
      dto.items.map((item) => ({ ...item, order_id: order.id })),
    );

    await this.auditService.log({
      tenant_id: tenant.tenantId,
      actor_id: actorId,
      actor_role: actorRole,
      action: 'invoice.hold',
      resource_type: 'invoice',
      resource_id: order.id,
      after_data: {
        branch_id: dto.branch_id,
        items_count: dto.items.length,
        subtotal,
      },
    });

    return this.repo.findById(tenant, order.id);
  }

  async listHeldOrders(
    tenant: TenantContext,
    branchId: string,
    actorId: string,
  ) {
    return this.repo.findHeldOrders(tenant, branchId, actorId);
  }

  async getHeldOrder(tenant: TenantContext, id: string) {
    const order = await this.repo.findById(tenant, id);
    if (!order || !(order as { held?: boolean }).held) {
      throw new NotFoundException('Held order not found');
    }
    return order;
  }

  async updateHeldVisibility(
    tenant: TenantContext,
    id: string,
    visibility: HeldOrderVisibility,
  ) {
    const updated = await this.repo.updateHeldVisibility(
      tenant,
      id,
      visibility,
    );
    if (!updated) {
      throw new NotFoundException('Held order not found');
    }
    return updated;
  }

  async cancelHeldOrder(
    tenant: TenantContext,
    id: string,
    actorId: string,
    actorRole: string,
  ) {
    const cancelled = await this.repo.cancelHeldOrder(tenant, id);
    if (!cancelled) {
      throw new NotFoundException('Held order not found');
    }

    await this.auditService.log({
      tenant_id: tenant.tenantId,
      actor_id: actorId,
      actor_role: actorRole,
      action: 'invoice.hold_cancel',
      resource_type: 'invoice',
      resource_id: id,
    });

    return { id, held: false };
  }
}
