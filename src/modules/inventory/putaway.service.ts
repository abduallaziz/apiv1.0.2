import { Injectable } from '@nestjs/common';
import { PutawayRepository } from './repositories/putaway.repository';
import { ItemsService } from '../items/items.service';
import { CreatePutawayRuleDto } from './dto/create-putaway-rule.dto';

@Injectable()
export class PutawayService {
  constructor(
    private readonly putawayRepo: PutawayRepository,
    private readonly itemsService: ItemsService,
  ) {}

  findAllRules(tenantId: string) {
    return this.putawayRepo.findAllRules(tenantId);
  }

  createRule(tenantId: string, dto: CreatePutawayRuleDto) {
    return this.putawayRepo.createRule(tenantId, {
      name: dto.name,
      warehouse_id: dto.warehouse_id ?? null,
      applies_to_item_id: dto.applies_to_item_id ?? null,
      applies_to_category_id: dto.applies_to_category_id ?? null,
      target_location_purpose: dto.target_location_purpose ?? 'storage',
      target_location_id: dto.target_location_id,
      priority: dto.priority ?? 100,
    });
  }

  async suggest(
    tenantId: string,
    warehouseId: string,
    itemId: string,
    quantity: number,
  ) {
    const item: any = await this.itemsService.findById(itemId, tenantId);
    return this.putawayRepo.suggestLocation(
      tenantId,
      warehouseId,
      itemId,
      item?.category_id ?? null,
      quantity,
    );
  }

  // Goods Receipt -> Putaway integration point. Called from
  // GoodsReceiptsService after posting (best-effort — never blocks the
  // already-completed receipt), mirroring the Quality Management
  // integration pattern (migration 13.19).
  async createFromReceipt(
    tenantId: string,
    warehouseId: string,
    itemId: string,
    variantId: string | null,
    batchId: string | null,
    quantity: number,
    sourceLocationId: string | null,
    receiptId: string,
    actorId: string | null,
  ) {
    const suggestion = await this.suggest(
      tenantId,
      warehouseId,
      itemId,
      quantity,
    );
    return this.putawayRepo.createTask(tenantId, {
      warehouse_id: warehouseId,
      item_id: itemId,
      variant_id: variantId,
      batch_id: batchId,
      quantity,
      source_location_id: sourceLocationId,
      suggested_location_id: suggestion?.location_id ?? null,
      source_document_type: 'goods_receipt',
      source_document_id: receiptId,
      created_by: actorId,
    });
  }
}
