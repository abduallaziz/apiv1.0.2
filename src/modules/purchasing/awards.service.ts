import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AwardsRepository } from './repositories/awards.repository';
import { SupplierQuotesRepository } from './repositories/supplier-quotes.repository';
import { PurchaseOrdersRepository } from './repositories/purchase-orders.repository';
import { CreateAwardDto } from './dto/create-award.dto';

@Injectable()
export class AwardsService {
  constructor(
    private readonly awardsRepo: AwardsRepository,
    private readonly supplierQuotesRepo: SupplierQuotesRepository,
    private readonly purchaseOrdersRepo: PurchaseOrdersRepository,
  ) {}

  async findAllForRfq(rfqId: string, tenantId: string) {
    return this.awardsRepo.findAllForRfq(rfqId, tenantId);
  }

  async findById(id: string, tenantId: string) {
    const award = await this.awardsRepo.findById(id, tenantId);
    if (!award) throw new NotFoundException('Award not found');
    return award;
  }

  // Snapshots pricing FROM each source_supplier_quote_item at award time —
  // never trusts client-submitted price/discount/currency/lead_time/tax,
  // so the award stays a true point-in-time record even if the supplier
  // later revises their quote (a new quote_group version never touches
  // this award's already-recorded values).
  async create(tenantId: string, dto: CreateAwardDto, createdBy: string) {
    const items = [];
    for (const line of dto.items) {
      const quoteItem = await this.supplierQuotesRepo.findQuoteItemById(
        line.source_supplier_quote_item_id,
        tenantId,
      );
      if (!quoteItem) {
        throw new BadRequestException(
          `Supplier quote item ${line.source_supplier_quote_item_id} not found`,
        );
      }
      items.push({
        rfq_item_id: line.rfq_item_id ?? quoteItem.rfq_item_id ?? null,
        source_supplier_quote_item_id: quoteItem.id,
        awarded_quantity: line.awarded_quantity,
        awarded_unit_price: quoteItem.unit_price,
        awarded_discount: quoteItem.discount_percent,
        awarded_currency: quoteItem.currency ?? 'SAR',
        awarded_lead_time: quoteItem.lead_time_days,
        awarded_tax_rate: quoteItem.tax_rate,
        notes: line.notes ?? null,
      });
    }

    return this.awardsRepo.create(
      tenantId,
      {
        rfq_id: dto.rfq_id,
        award_number: dto.award_number,
        notes: dto.notes ?? null,
      },
      items,
      createdBy,
    );
  }

  async confirm(id: string, tenantId: string) {
    await this.findById(id, tenantId);
    return this.awardsRepo.confirm(id, tenantId);
  }

  async cancel(id: string, tenantId: string) {
    await this.findById(id, tenantId);
    return this.awardsRepo.cancel(id, tenantId);
  }

  // The ONLY path that creates a purchase order for an RFQ-sourced
  // purchase — always from a confirmed award's snapshot, never directly
  // from a supplier quote. One PO per supplier represented in the award,
  // so a future partial award spanning multiple suppliers already
  // produces the correct multiple POs with zero extra logic.
  async createPurchaseOrders(
    id: string,
    tenantId: string,
    warehouseId: string,
    orderNumberPrefix: string,
    actorId: string,
  ) {
    const award = await this.findById(id, tenantId);
    if (award.status !== 'confirmed') {
      throw new BadRequestException(
        `Cannot create purchase orders from award with status: ${award.status}`,
      );
    }

    const rows = await this.awardsRepo.findItemsForPoGeneration(id, tenantId);
    const bySupplier = new Map<string, typeof rows>();
    for (const row of rows as any[]) {
      const supplierId =
        row.quote_item?.supplier_quotes?.quote_groups?.supplier_id;
      if (!supplierId) continue;
      if (!bySupplier.has(supplierId)) bySupplier.set(supplierId, []);
      bySupplier.get(supplierId).push(row);
    }

    const createdPOs = [];
    let index = 0;
    for (const [supplierId, supplierRows] of bySupplier) {
      index += 1;
      const po = await this.purchaseOrdersRepo.create(
        tenantId,
        {
          supplier_id: supplierId,
          warehouse_id: warehouseId,
          order_number: `${orderNumberPrefix}-${index}`,
          order_date: new Date().toISOString().slice(0, 10),
          source_rfq_id: award.rfq_id,
          source_supplier_quote_id:
            (supplierRows[0] as any).quote_item?.supplier_quote_id ?? null,
          source_award_id: award.id,
        },
        supplierRows.map((row: any) => ({
          item_id: row.quote_item.item_id,
          variant_id: row.quote_item.variant_id ?? null,
          quantity_ordered: row.awarded_quantity,
          unit_cost: row.awarded_unit_price,
          source_supplier_quote_item_id: row.source_supplier_quote_item_id,
          source_award_item_id: row.id,
        })),
        actorId,
      );
      createdPOs.push(po);
    }

    return createdPOs;
  }
}
