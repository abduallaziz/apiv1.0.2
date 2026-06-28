import { Injectable, NotFoundException } from '@nestjs/common';
import { CountsRepository } from './repositories/counts.repository';
import { CreateStockCountDto } from './dto/create-stock-count.dto';
import { SubmitCountItemDto } from './dto/submit-count-item.dto';
import { throwFromRpcError } from './rpc-error.util';

@Injectable()
export class CountsService {
  constructor(private readonly countsRepo: CountsRepository) {}

  async findAll(tenantId: string, status?: string) {
    const counts = await this.countsRepo.findAll(tenantId, status);
    return (counts ?? []).map((c: any) => ({
      ...c,
      warehouse_name: c.warehouses?.name ?? null,
    }));
  }

  async findById(id: string, tenantId: string) {
    const count: any = await this.countsRepo.findById(id, tenantId);
    if (!count) throw new NotFoundException('Stock count not found');
    return {
      ...count,
      warehouse_name: count.warehouses?.name ?? null,
      items: (count.items ?? []).map((item: any) => ({
        ...item,
        item_name: item.items?.name ?? null,
      })),
    };
  }

  create(tenantId: string, dto: CreateStockCountDto, actorId: string) {
    return this.countsRepo.create(
      tenantId,
      { warehouse_id: dto.warehouse_id, count_number: dto.count_number, notes: dto.notes ?? null },
      actorId,
    );
  }

  async submitCount(countId: string, countItemId: string, tenantId: string, dto: SubmitCountItemDto) {
    await this.findById(countId, tenantId);
    return this.countsRepo.submitCount(countItemId, tenantId, dto.counted_quantity);
  }

  async finalize(id: string, tenantId: string, actorId: string) {
    await this.findById(id, tenantId);
    try {
      return await this.countsRepo.finalize(id, actorId);
    } catch (error) {
      throwFromRpcError(error as { message: string; code?: string });
    }
  }
}
