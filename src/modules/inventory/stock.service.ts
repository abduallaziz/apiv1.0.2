import { Injectable } from '@nestjs/common';
import { StockRepository, StockLevelFilter } from './repositories/stock.repository';

@Injectable()
export class StockService {
  constructor(private readonly stockRepo: StockRepository) {}

  findLevels(tenantId: string, filter: StockLevelFilter) {
    return this.stockRepo.findLevels(tenantId, filter);
  }

  findMovements(
    tenantId: string,
    filter: StockLevelFilter & { referenceType?: string; referenceId?: string },
    page = 1,
    perPage = 50,
  ) {
    return this.stockRepo.findMovements(tenantId, filter, page, perPage);
  }
}
