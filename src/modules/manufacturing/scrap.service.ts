import { Injectable, NotFoundException } from '@nestjs/common';
import { ScrapRepository } from './repositories/scrap.repository';
import { ProductionOrdersRepository } from './repositories/production-orders.repository';
import { CreateScrapDto } from './dto/create-scrap.dto';
import { throwFromRpcError } from '../inventory/rpc-error.util';

@Injectable()
export class ScrapService {
  constructor(
    private readonly scrapRepo: ScrapRepository,
    private readonly productionOrdersRepo: ProductionOrdersRepository,
  ) {}

  private async findOrder(productionOrderId: string, tenantId: string) {
    const order = await this.productionOrdersRepo.findById(productionOrderId, tenantId);
    if (!order) throw new NotFoundException('Production order not found');
    return order as any;
  }

  findByProductionOrder(productionOrderId: string, tenantId: string) {
    return this.scrapRepo.findByProductionOrder(productionOrderId, tenantId);
  }

  async record(productionOrderId: string, tenantId: string, actorId: string | null, dto: CreateScrapDto) {
    const order = await this.findOrder(productionOrderId, tenantId);
    try {
      return await this.scrapRepo.record(
        tenantId,
        order.warehouse_id,
        productionOrderId,
        dto.item_id,
        dto.variant_id ?? null,
        dto.quantity,
        dto.reason ?? null,
        actorId,
      );
    } catch (error) {
      throwFromRpcError(error as { message: string; code?: string });
    }
  }
}
