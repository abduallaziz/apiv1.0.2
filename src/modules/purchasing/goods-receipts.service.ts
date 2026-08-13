import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { GoodsReceiptsRepository } from './repositories/goods-receipts.repository';
import { CreateGoodsReceiptDto } from './dto/create-goods-receipt.dto';
import { throwFromRpcError } from '../inventory/rpc-error.util';
import { LocationsService } from '../inventory/locations.service';
import { PaginationDto } from '../../shared/dto/pagination.dto';
import { PurchaseOrdersService } from './purchase-orders.service';
import { QualityConfigService } from '../quality/quality-config.service';
import { InspectionsService } from '../quality/inspections.service';
import { PutawayService } from '../inventory/putaway.service';

// A receipt can only be created against a PO that's actually been approved
// — 'partially_received' is included because a PO naturally sits there
// after its first receipt, and further receipts against it are entirely
// normal (the real enforcement gap this closes is 'draft'/'submitted').
const RECEIVABLE_PO_STATUSES = ['approved', 'partially_received'];

@Injectable()
export class GoodsReceiptsService {
  constructor(
    private readonly goodsReceiptsRepo: GoodsReceiptsRepository,
    private readonly locationsService: LocationsService,
    private readonly purchaseOrdersService: PurchaseOrdersService,
    private readonly qualityConfigService: QualityConfigService,
    private readonly inspectionsService: InspectionsService,
    private readonly putawayService: PutawayService,
  ) {}

  async findAll(
    tenantId: string,
    status?: string,
    page?: string,
    perPage?: string,
  ) {
    return (
      (await this.goodsReceiptsRepo.findAll(
        tenantId,
        status,
        new PaginationDto(page, perPage),
      )) ?? []
    );
  }

  async findById(id: string, tenantId: string) {
    const receipt: any = await this.goodsReceiptsRepo.findById(id, tenantId);
    if (!receipt) throw new NotFoundException('Goods receipt not found');
    return {
      ...receipt,
      warehouse_name: receipt.warehouses?.name ?? null,
      purchase_order_number: receipt.purchase_orders?.order_number ?? null,
      supplier_name: receipt.purchase_orders?.suppliers?.name ?? null,
      items: (receipt.items ?? []).map((item: any) => ({
        ...item,
        item_name: item.items?.name ?? null,
        quantity_ordered: item.purchase_order_items?.quantity_ordered ?? null,
      })),
    };
  }

  async create(tenantId: string, dto: CreateGoodsReceiptDto) {
    const { items, ...header } = dto;

    if (header.purchase_order_id) {
      const po = await this.purchaseOrdersService.findById(
        header.purchase_order_id,
        tenantId,
      );
      if (!RECEIVABLE_PO_STATUSES.includes(po.status)) {
        throw new ConflictException(
          `Cannot receive against purchase order with status '${po.status}' — it must be approved first`,
        );
      }
    }

    const convertedLines = [];
    for (const line of items) {
      if (line.location_id) {
        await this.locationsService.findById(
          line.location_id,
          header.warehouse_id,
          tenantId,
        );
      }
      if (line.ownership_type === 'consignment' && !line.owner_supplier_id) {
        throw new BadRequestException('owner_supplier_id is required when ownership_type is consignment');
      }

      // A line entered in an alternate unit (e.g. "2 cartons") is converted
      // to the item's storage unit once here, at data entry — everything
      // downstream (fn_post_goods_receipt, cost_layers, stock_movements)
      // stays exactly as it is today and never becomes unit-aware.
      let quantityReceived = line.quantity_received;
      let unitCost = line.unit_cost;
      if (line.unit_id) {
        const factor = await this.goodsReceiptsRepo.convertToStorageUnit(
          line.item_id,
          1,
          line.unit_id,
        );
        quantityReceived = line.quantity_received * factor;
        unitCost = factor > 0 ? line.unit_cost / factor : line.unit_cost;
      }

      convertedLines.push({
        purchase_order_item_id: line.purchase_order_item_id ?? null,
        item_id: line.item_id,
        variant_id: line.variant_id ?? null,
        quantity_received: quantityReceived,
        unit_cost: unitCost,
        batch_number: line.batch_number ?? null,
        serial_number: line.serial_number ?? null,
        expiration_date: line.expiration_date ?? null,
        location_id: line.location_id ?? null,
        unit_id: line.unit_id ?? null,
        ownership_type: line.ownership_type && line.ownership_type !== 'company' ? line.ownership_type : null,
        owner_supplier_id: line.owner_supplier_id ?? null,
      });
    }

    return this.goodsReceiptsRepo.create(
      tenantId,
      {
        purchase_order_id: header.purchase_order_id ?? null,
        warehouse_id: header.warehouse_id,
        receipt_number: header.receipt_number,
        notes: header.notes ?? null,
      },
      convertedLines,
    );
  }

  async post(id: string, tenantId: string, actorId: string) {
    const receipt = await this.findById(id, tenantId);
    let posted;
    try {
      posted = await this.goodsReceiptsRepo.post(id, actorId);
    } catch (error) {
      throwFromRpcError(error as { message: string; code?: string });
    }
    await this.autoCreateInspections(tenantId, receipt, actorId);
    await this.autoCreatePutawayTasks(tenantId, receipt, actorId);
    return posted;
  }

  // Goods Receipt -> Putaway (Migration 13.20 integration point). Creates a
  // putaway task per received line, with a suggested location resolved
  // from putaway_rules. Does NOT move stock — fn_post_goods_receipt
  // (unmodified) already placed the item wherever the receipt line
  // specified; this task tracks the physical relocation to the suggested
  // storage location. Best-effort, same principle as autoCreateInspections
  // above — never blocks the already-completed receipt.
  private async autoCreatePutawayTasks(tenantId: string, receipt: any, actorId: string) {
    for (const item of receipt.items ?? []) {
      try {
        await this.putawayService.createFromReceipt(
          tenantId, receipt.warehouse_id, item.item_id, item.variant_id ?? null, item.batch_id ?? null,
          Number(item.quantity_received), item.location_id ?? null, receipt.id, actorId,
        );
      } catch {
        // best-effort — never block the already-completed receipt
      }
    }
  }

  // Goods Receipt -> Inspection (Migration 13.19 integration point).
  // Resolves quality_rules for each received item; if a rule with
  // action='require_inspection' matches, creates a pending
  // quality_inspection. Deliberately best-effort: a quality-config lookup
  // failure must never block the receipt posting that already succeeded
  // (the physical/financial transaction is the priority — same principle
  // as the existing advisory-only quality hold check on the sales side).
  private async autoCreateInspections(tenantId: string, receipt: any, actorId: string) {
    const supplierId = receipt.purchase_orders?.supplier_id ?? null;
    for (const item of receipt.items ?? []) {
      try {
        const rule = await this.qualityConfigService.resolvePlan(
          tenantId, 'goods_receipt', item.item_id, null, supplierId, receipt.warehouse_id,
        );
        if (rule?.action === 'require_inspection') {
          await this.inspectionsService.create(tenantId, {
            reference_type: 'goods_receipt',
            reference_id: receipt.id,
            item_id: item.item_id,
            variant_id: item.variant_id ?? undefined,
            template_id: rule.template_id ?? undefined,
            warehouse_id: receipt.warehouse_id,
            quantity_inspected: item.quantity_received,
          } as any, actorId);
        }
      } catch {
        // best-effort — never block the already-completed receipt
      }
    }
  }

  async cancel(id: string, tenantId: string) {
    await this.findById(id, tenantId);
    return this.goodsReceiptsRepo.cancel(id, tenantId);
  }
}
