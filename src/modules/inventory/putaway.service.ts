import { Injectable } from '@nestjs/common';
import { PutawayRepository } from './repositories/putaway.repository';
import { ItemsService } from '../items/items.service';
import { CreatePutawayRuleDto } from './dto/create-putaway-rule.dto';
import { WarehousesService } from './warehouses.service';
import { AuditService } from '../../core/audit/audit.service';

@Injectable()
export class PutawayService {
  constructor(
    private readonly putawayRepo: PutawayRepository,
    private readonly itemsService: ItemsService,
    private readonly warehousesService: WarehousesService,
    private readonly auditService: AuditService,
  ) {}

  // Branch System Step 5 (Owner-approved) — see identical helper in
  // ProductionOrdersService. putaway_rules.warehouse_id is nullable (a rule
  // can be tenant-wide), so this correctly returns null for those.
  private async resolveBranchForWarehouse(
    warehouseId: string | null | undefined,
    tenantId: string,
  ): Promise<string | null> {
    if (!warehouseId) return null;
    try {
      const warehouse = await this.warehousesService.findById(
        warehouseId,
        tenantId,
      );
      return warehouse?.branch_id ?? null;
    } catch {
      return null;
    }
  }

  findAllRules(tenantId: string) {
    return this.putawayRepo.findAllRules(tenantId);
  }

  async createRule(
    tenantId: string,
    dto: CreatePutawayRuleDto,
    actorId: string,
  ) {
    const rule = await this.putawayRepo.createRule(tenantId, {
      name: dto.name,
      warehouse_id: dto.warehouse_id ?? null,
      applies_to_item_id: dto.applies_to_item_id ?? null,
      applies_to_category_id: dto.applies_to_category_id ?? null,
      target_location_purpose: dto.target_location_purpose ?? 'storage',
      target_location_id: dto.target_location_id,
      priority: dto.priority ?? 100,
    });

    await this.auditService
      .log({
        tenant_id: tenantId,
        actor_id: actorId,
        action: 'putaway_rule.created',
        resource_type: 'putaway_rule',
        resource_id: (rule as { id?: string })?.id,
        branch_id: await this.resolveBranchForWarehouse(
          dto.warehouse_id,
          tenantId,
        ),
      })
      .catch(() => {});

    return rule;
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
