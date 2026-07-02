import { Injectable, NotFoundException } from '@nestjs/common';
import { CountsRepository } from './repositories/counts.repository';
import { PaginationDto } from '../../shared/dto/pagination.dto';
import { CreateStockCountDto } from './dto/create-stock-count.dto';
import { SubmitCountItemDto } from './dto/submit-count-item.dto';
import { throwFromRpcError } from './rpc-error.util';
import { StockService } from './stock.service';

@Injectable()
export class CountsService {
  constructor(
    private readonly countsRepo: CountsRepository,
    private readonly stockService: StockService,
  ) {}

  async findAll(tenantId: string, status?: string, page?: string, perPage?: string) {
    return (await this.countsRepo.findAll(tenantId, status, new PaginationDto(page, perPage))) ?? [];
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
        location_code: item.warehouse_locations?.code ?? null,
        location_name: item.warehouse_locations?.name ?? null,
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
      const result = await this.countsRepo.finalize(id, actorId);
      await this.stockService.invalidateStockCache(tenantId);
      return result;
    } catch (error) {
      throwFromRpcError(error as { message: string; code?: string });
    }
  }
}
