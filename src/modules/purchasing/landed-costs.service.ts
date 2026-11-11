import { ConflictException, Injectable } from '@nestjs/common';
import { LandedCostsRepository } from './repositories/landed-costs.repository';
import { GoodsReceiptsService } from './goods-receipts.service';
import { WarehousesService } from '../inventory/warehouses.service';
import { AuditService } from '../../core/audit/audit.service';
import { CreateLandedCostDto } from './dto/create-landed-cost.dto';

@Injectable()
export class LandedCostsService {
  constructor(
    private readonly landedCostsRepo: LandedCostsRepository,
    private readonly goodsReceiptsService: GoodsReceiptsService,
    private readonly warehousesService: WarehousesService,
    private readonly auditService: AuditService,
  ) {}

  // Branch System Step 5 (Owner-approved) — see identical helper in
  // ProductionOrdersService for the full rationale. landed_costs has no
  // warehouse_id of its own — this resolves the 2-hop chain via the
  // already-loaded parent goods receipt.
  private async resolveBranchForWarehouse(
    warehouseId: string,
    tenantId: string,
  ): Promise<string | null> {
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

  async findByReceipt(goodsReceiptId: string, tenantId: string) {
    await this.goodsReceiptsService.findById(goodsReceiptId, tenantId); // 404s if not found/wrong tenant
    return this.landedCostsRepo.findByReceipt(goodsReceiptId, tenantId);
  }

  // landed_costs rows must exist BEFORE the receipt is posted (migration
  // 110's own design: fn_post_goods_receipt bakes them into unit_cost at
  // posting time — untouched by this migration). Enforced here at the
  // application layer since fn_post_goods_receipt itself is not modified.
  async create(
    goodsReceiptId: string,
    tenantId: string,
    actorId: string,
    dto: CreateLandedCostDto,
  ) {
    const receipt: any = await this.goodsReceiptsService.findById(
      goodsReceiptId,
      tenantId,
    );
    if (receipt.status !== 'draft') {
      throw new ConflictException(
        `Cannot add a landed cost to goods receipt with status "${receipt.status}" — it must still be draft (unposted). Landed costs are baked into unit cost at posting time.`,
      );
    }
    const cost = await this.landedCostsRepo.create(
      goodsReceiptId,
      tenantId,
      actorId,
      {
        cost_type: dto.cost_type,
        amount: dto.amount,
        allocation_method: dto.allocation_method ?? 'by_value',
        notes: dto.notes ?? null,
      },
    );

    await this.auditService
      .log({
        tenant_id: tenantId,
        actor_id: actorId,
        action: 'landed_cost.created',
        resource_type: 'landed_cost',
        resource_id: (cost as { id: string }).id,
        branch_id: await this.resolveBranchForWarehouse(
          (receipt as { warehouse_id?: string | null }).warehouse_id,
          tenantId,
        ),
      })
      .catch(() => {});

    return cost;
  }
}
