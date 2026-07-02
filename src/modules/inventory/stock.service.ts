import { Injectable } from '@nestjs/common';
import {
  StockRepository,
  StockLevelFilter,
  StockLevelEnrichedFilter,
  MovementsLedgerFilter,
} from './repositories/stock.repository';
import { RedisCacheService } from '../../core/cache/redis-cache.service';

const STOCK_CACHE_TTL = 180; // 3 minutes
const stockCachePrefix = (tenantId: string) => `stock:tenant:${tenantId}:`;

@Injectable()
export class StockService {
  constructor(
    private readonly stockRepo: StockRepository,
    private readonly cache: RedisCacheService,
  ) {}

  async findLevels(tenantId: string, filter: StockLevelFilter) {
    const key = `${stockCachePrefix(tenantId)}levels:wh:${filter.warehouseId ?? 'all'}:item:${filter.itemId ?? 'all'}:variant:${filter.variantId ?? 'all'}`;

    const cached = await this.cache.get<Awaited<ReturnType<StockRepository['findLevels']>>>(key);
    if (cached) return cached;

    const data = await this.stockRepo.findLevels(tenantId, filter);
    await this.cache.set(key, data, STOCK_CACHE_TTL);
    return data;
  }

  async findLevelsEnriched(tenantId: string, filter: StockLevelEnrichedFilter) {
    const key =
      `${stockCachePrefix(tenantId)}levels-enriched:wh:${filter.warehouseId ?? 'all'}:item:${filter.itemId ?? 'all'}` +
      `:category:${filter.categoryId ?? 'all'}:location:${filter.locationId ?? 'all'}:batch:${filter.batchId ?? 'all'}` +
      `:supplier:${filter.supplierId ?? 'all'}:status:${filter.status ?? 'all'}`;

    const cached = await this.cache.get<Awaited<ReturnType<StockRepository['findLevelsEnriched']>>>(key);
    if (cached) return cached;

    const data = await this.stockRepo.findLevelsEnriched(tenantId, filter);
    await this.cache.set(key, data, STOCK_CACHE_TTL);
    return data;
  }

  async findMovementsLedger(tenantId: string, filter: MovementsLedgerFilter, page = 1, perPage = 50) {
    const key =
      `${stockCachePrefix(tenantId)}movements-ledger:wh:${filter.warehouseId ?? 'all'}:item:${filter.itemId ?? 'all'}` +
      `:type:${filter.movementType ?? 'all'}:refType:${filter.referenceType ?? 'all'}:refId:${filter.referenceId ?? 'all'}` +
      `:createdBy:${filter.createdBy ?? 'all'}:from:${filter.dateFrom ?? 'any'}:to:${filter.dateTo ?? 'any'}:page:${page}:perPage:${perPage}`;

    const cached = await this.cache.get<Awaited<ReturnType<StockRepository['findMovementsLedger']>>>(key);
    if (cached) return cached;

    const data = await this.stockRepo.findMovementsLedger(tenantId, filter, page, perPage);
    await this.cache.set(key, data, STOCK_CACHE_TTL);
    return data;
  }

  async findMovements(
    tenantId: string,
    filter: StockLevelFilter & { referenceType?: string; referenceId?: string },
    page = 1,
    perPage = 50,
  ) {
    const key =
      `${stockCachePrefix(tenantId)}movements:wh:${filter.warehouseId ?? 'all'}:item:${filter.itemId ?? 'all'}` +
      `:variant:${filter.variantId ?? 'all'}:refType:${filter.referenceType ?? 'all'}:refId:${filter.referenceId ?? 'all'}` +
      `:page:${page}:perPage:${perPage}`;

    const cached = await this.cache.get<Awaited<ReturnType<StockRepository['findMovements']>>>(key);
    if (cached) return cached;

    const data = await this.stockRepo.findMovements(tenantId, filter, page, perPage);
    await this.cache.set(key, data, STOCK_CACHE_TTL);
    return data;
  }

  async applyStockMovement(params: Parameters<StockRepository['callApplyStockMovement']>[0]) {
    const result = await this.stockRepo.callApplyStockMovement(params);
    await this.cache.delByPrefix(stockCachePrefix(params.p_tenant_id));
    return result;
  }

  async invalidateStockCache(tenantId: string): Promise<void> {
    await this.cache.delByPrefix(stockCachePrefix(tenantId));
  }
}
