import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { TablesRepository } from './repositories/tables.repository';
import { DineInRepository } from './repositories/dine-in.repository';
import { InvoicesRepository } from '../invoices/repositories/invoices.repository';
import { PosEngine } from '../../engines/pos-engine/pos.engine';
import { PaymentEngine } from '../../engines/payment-engine/payment.engine';
import { TenantsRepository } from '../tenants/repositories/tenants.repository';
import { AuditService } from '../../core/audit/audit.service';
import { TenantContext } from '../../core/tenant/tenant-context';
import { AddDineInItemsDto } from './dto/add-dine-in-items.dto';
import { CheckoutDineInDto } from './dto/checkout-dine-in.dto';

@Injectable()
export class DineInService {
  private readonly logger = new Logger(DineInService.name);

  constructor(
    private readonly tablesRepo: TablesRepository,
    private readonly dineInRepo: DineInRepository,
    private readonly invoicesRepo: InvoicesRepository,
    private readonly posEngine: PosEngine,
    private readonly paymentEngine: PaymentEngine,
    private readonly tenantsRepo: TenantsRepository,
    private readonly auditService: AuditService,
  ) {}

  async openTable(tenant: TenantContext, tableId: string, cashierId: string) {
    const table = await this.tablesRepo.findById(tableId, tenant.tenantId);
    if (!table) throw new NotFoundException('Table not found');

    // fn_open_dine_in_table re-checks availability itself (with a row lock) and
    // raises a Postgres exception otherwise — this earlier check is just a fast,
    // friendlier fail before hitting the DB for the common case.
    if (table.status !== 'available') {
      throw new BadRequestException(`Table is not available (status: ${table.status})`);
    }

    try {
      return await this.dineInRepo.openTableAtomic(tenant.tenantId, tableId, table.branch_id, cashierId);
    } catch (err: any) {
      if (err?.message?.includes('not available')) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }

  async addItems(tenant: TenantContext, tableId: string, dto: AddDineInItemsDto) {
    // الطلب المفتوح ونسبة الضريبة مستقلان تمامًا عن بعضهما — يُنفَّذان بالتوازي بدل التسلسل.
    const [order, taxRate] = await Promise.all([
      this.dineInRepo.findOpenOrderByTable(tenant.tenantId, tableId),
      this.tenantsRepo.getTaxRate(tenant.tenantId),
    ]);
    if (!order) throw new NotFoundException('No open order for this table — open the table first');

    await this.dineInRepo.insertItems(order.id, tenant.tenantId, dto.items);

    const allItems = await this.dineInRepo.getOrderItems(order.id);
    const built = this.posEngine.buildInvoice(
      allItems.map((i) => ({
        item_id: i.item_id,
        item_name: i.item_name,
        variant_id: i.variant_id ?? undefined,
        variant_name: i.variant_name ?? undefined,
        quantity: i.qty,
        unit_price: i.price,
      })),
      undefined,
      taxRate,
    );

    await this.dineInRepo.updateOrderTotals(order.id, tenant.tenantId, {
      subtotal: built.subtotal,
      discount: built.discount_amount,
      tax: built.tax_amount,
      total: built.total,
    });

    // يبني الاستجابة مباشرة من البيانات المتوفرة أصلًا (الطلب + العناصر المُجلَبة للتو +
    // الإجماليات المحسوبة أعلاه) بدل استدعاء getCurrentOrder() الذي كان يعيد جلب الطلب
    // ونفس العناصر من الصفر — رحلتان زائدتان لقاعدة البيانات بكل عملية إضافة صنف.
    return {
      ...order,
      subtotal: built.subtotal,
      discount: built.discount_amount,
      tax: built.tax_amount,
      total: built.total,
      items: allItems,
    };
  }

  async getCurrentOrder(tenant: TenantContext, tableId: string) {
    const order = await this.dineInRepo.findOpenOrderByTable(tenant.tenantId, tableId);
    if (!order) throw new NotFoundException('No open order for this table');
    const items = await this.dineInRepo.getOrderItems(order.id);
    return { ...order, items };
  }

  async checkout(
    tenant: TenantContext,
    tableId: string,
    dto: CheckoutDineInDto,
    cashierId: string,
    actorRole: string,
    ip: string,
    device: string,
  ) {
    const order = await this.dineInRepo.findOpenOrderByTable(tenant.tenantId, tableId);
    if (!order) throw new NotFoundException('No open order for this table');
    if (order.total <= 0) {
      throw new BadRequestException('Cannot check out a table with no items ordered');
    }

    if (dto.payment_method === 'cash') {
      if (!dto.cash_tendered) {
        throw new BadRequestException('cash_tendered required for cash payment');
      }
      this.paymentEngine.processCashPayment(order.total, dto.cash_tendered);
    } else if (dto.payment_method === 'split') {
      if (dto.cash_amount === undefined || dto.card_amount === undefined) {
        throw new BadRequestException('cash_amount and card_amount required for split payment');
      }
      this.paymentEngine.processSplitPayment(order.total, dto.cash_amount, dto.card_amount);
    }

    // ذرّي عبر fn_checkout_dine_in_table — إنهاء الطلب وتحرير الطاولة بمعاملة واحدة،
    // بدل خطوتين منفصلتين قد تتباعدان لو فشلت الثانية بعد نجاح الأولى.
    const finalized = await this.dineInRepo.checkoutAtomic(
      tenant.tenantId,
      order.id,
      tableId,
      dto.payment_method,
      dto.customer_id ?? null,
    );
    if (!finalized) {
      throw new BadRequestException('Order was already checked out or no longer open');
    }

    await this.auditService.log({
      tenant_id: tenant.tenantId,
      actor_id: cashierId,
      actor_role: actorRole,
      action: 'dine_in.checkout',
      resource_type: 'order',
      resource_id: order.id,
      after_data: { total: order.total, payment_method: dto.payment_method, table_id: tableId },
      ip_address: ip,
      device,
    });

    // خصم المخزون: نفس منطق POS العادي، best-effort (راجع STATUS.md §64)
    const warehouseId = await this.invoicesRepo.getBranchDefaultWarehouse(order.branch_id);
    if (warehouseId) {
      const items = await this.dineInRepo.getOrderItems(order.id);
      this.invoicesRepo
        .deductStockForSale(
          tenant.tenantId,
          warehouseId,
          order.id,
          cashierId,
          items.map((i) => ({ item_id: i.item_id, variant_id: i.variant_id ?? null, quantity: i.qty })),
        )
        .catch((err) => {
          this.logger.warn(`Stock deduction failed for dine-in order ${order.id}: ${err?.message ?? err}`);
        });
    }

    return { id: order.id, total: order.total, status: 'completed' };
  }
}
