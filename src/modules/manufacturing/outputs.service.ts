import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OutputsRepository } from './repositories/outputs.repository';
import { ProductionOrdersRepository } from './repositories/production-orders.repository';
import { CreateOutputDto } from './dto/create-output.dto';
import { UpdateOutputDto } from './dto/update-output.dto';
import { throwFromRpcError } from '../inventory/rpc-error.util';

@Injectable()
export class OutputsService {
  constructor(
    private readonly outputsRepo: OutputsRepository,
    private readonly productionOrdersRepo: ProductionOrdersRepository,
  ) {}

  private async findOrder(productionOrderId: string, tenantId: string) {
    const order = await this.productionOrdersRepo.findById(
      productionOrderId,
      tenantId,
    );
    if (!order) throw new NotFoundException('Production order not found');
    return order;
  }

  findByProductionOrder(productionOrderId: string, tenantId: string) {
    return this.outputsRepo.findByProductionOrder(productionOrderId, tenantId);
  }

  async create(
    productionOrderId: string,
    tenantId: string,
    dto: CreateOutputDto,
  ) {
    await this.findOrder(productionOrderId, tenantId);
    return this.outputsRepo.create(productionOrderId, tenantId, {
      item_id: dto.item_id,
      variant_id: dto.variant_id ?? null,
      quantity: dto.quantity,
      unit_cost: dto.unit_cost,
      output_type: 'by_product',
    });
  }

  async update(
    outputId: string,
    productionOrderId: string,
    tenantId: string,
    dto: UpdateOutputDto,
  ) {
    await this.findOrder(productionOrderId, tenantId);
    const existing: any = await this.outputsRepo.findById(outputId, tenantId);
    if (!existing || existing.production_order_id !== productionOrderId) {
      throw new NotFoundException('Output not found on this production order');
    }
    if (existing.movement_id) {
      throw new BadRequestException(
        'Cannot edit an output that has already been received — the receipt is part of the immutable stock ledger',
      );
    }
    const updated = await this.outputsRepo.update(outputId, tenantId, {
      ...dto,
    });
    if (!updated) throw new NotFoundException('Output not found');
    return updated;
  }

  // Called by ProductionOrdersService.complete() right after
  // fn_post_production_order succeeds. A no-op when no by_product rows
  // were ever created for this order — existing production orders (and
  // any tenant who never uses by-products) are completely unaffected.
  async receiveAllUnposted(
    productionOrderId: string,
    tenantId: string,
    warehouseId: string,
    actorId: string | null,
  ) {
    const unposted = await this.outputsRepo.findUnpostedByProducts(
      productionOrderId,
      tenantId,
    );
    for (const output of unposted) {
      try {
        await this.outputsRepo.receive(
          tenantId,
          warehouseId,
          output.id,
          actorId,
        );
      } catch (error) {
        throwFromRpcError(error as { message: string; code?: string });
      }
    }
  }

  // Purely informational — mirrors what fn_post_production_order already
  // posted for the main item. Never drives new posting logic; movementId/
  // quantity/unitCost are read from the real stock_movements row that
  // function created, not recomputed here.
  async recordMainProductOutput(
    productionOrderId: string,
    tenantId: string,
    itemId: string,
    variantId: string | null,
    quantity: number,
    unitCost: number,
    movementId: string,
  ) {
    return this.outputsRepo.create(productionOrderId, tenantId, {
      item_id: itemId,
      variant_id: variantId,
      quantity,
      unit_cost: unitCost,
      output_type: 'main_product',
      movement_id: movementId,
    });
  }
}
