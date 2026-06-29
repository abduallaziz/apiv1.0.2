import { Injectable, NotFoundException } from '@nestjs/common';
import { GoodsReceiptsRepository } from './repositories/goods-receipts.repository';
import { CreateGoodsReceiptDto } from './dto/create-goods-receipt.dto';
import { throwFromRpcError } from '../inventory/rpc-error.util';

@Injectable()
export class GoodsReceiptsService {
  constructor(private readonly goodsReceiptsRepo: GoodsReceiptsRepository) {}

  async findAll(tenantId: string, status?: string) {
    const receipts = await this.goodsReceiptsRepo.findAll(tenantId, status);
    return (receipts ?? []).map((r: any) => ({
      ...r,
      warehouse_name: r.warehouses?.name ?? null,
      purchase_order_number: r.purchase_orders?.order_number ?? null,
    }));
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
