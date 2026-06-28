import { Injectable, NotFoundException } from '@nestjs/common';
import { GoodsReceiptsRepository } from './repositories/goods-receipts.repository';
import { CreateGoodsReceiptDto } from './dto/create-goods-receipt.dto';
import { throwFromRpcError } from '../inventory/rpc-error.util';

@Injectable()
export class GoodsReceiptsService {
  constructor(private readonly goodsReceiptsRepo: GoodsReceiptsRepository) {}

  findAll(tenantId: string, status?: string) {
    return this.goodsReceiptsRepo.findAll(tenantId, status);
  }

  async findById(id: string, tenantId: string) {
    const receipt = await this.goodsReceiptsRepo.findById(id, tenantId);
    if (!receipt) throw new NotFoundException('Goods receipt not found');
    return receipt;
  }

  create(tenantId: string, dto: CreateGoodsReceiptDto) {
    const { items, ...header } = dto;
    return this.goodsReceiptsRepo.create(
      tenantId,
      {
        purchase_order_id: header.purchase_order_id ?? null,
        warehouse_id: header.warehouse_id,
        receipt_number: header.receipt_number,
        notes: header.notes ?? null,
      },
      items.map((line) => ({
        purchase_order_item_id: line.purchase_order_item_id ?? null,
        item_id: line.item_id,
        variant_id: line.variant_id ?? null,
        quantity_received: line.quantity_received,
        unit_cost: line.unit_cost,
        batch_number: line.batch_number ?? null,
        serial_number: line.serial_number ?? null,
        expiration_date: line.expiration_date ?? null,
      })),
    );
  }

  async post(id: string, tenantId: string, actorId: string) {
    await this.findById(id, tenantId);
    try {
      return await this.goodsReceiptsRepo.post(id, actorId);
    } catch (error) {
      throwFromRpcError(error as { message: string; code?: string });
    }
  }

  async cancel(id: string, tenantId: string) {
    await this.findById(id, tenantId);
    return this.goodsReceiptsRepo.cancel(id, tenantId);
  }
}
