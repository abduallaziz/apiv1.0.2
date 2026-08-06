import { ConflictException, Injectable } from '@nestjs/common';
import { LandedCostsRepository } from './repositories/landed-costs.repository';
import { GoodsReceiptsService } from './goods-receipts.service';
import { CreateLandedCostDto } from './dto/create-landed-cost.dto';

@Injectable()
export class LandedCostsService {
  constructor(
    private readonly landedCostsRepo: LandedCostsRepository,
    private readonly goodsReceiptsService: GoodsReceiptsService,
  ) {}

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
    const receipt: any = await this.goodsReceiptsService.findById(goodsReceiptId, tenantId);
    if (receipt.status !== 'draft') {
      throw new ConflictException(
        `Cannot add a landed cost to goods receipt with status "${receipt.status}" — it must still be draft (unposted). Landed costs are baked into unit cost at posting time.`,
      );
    }
    return this.landedCostsRepo.create(goodsReceiptId, tenantId, actorId, {
      cost_type: dto.cost_type,
      amount: dto.amount,
      allocation_method: dto.allocation_method ?? 'by_value',
      notes: dto.notes ?? null,
    });
  }
}
