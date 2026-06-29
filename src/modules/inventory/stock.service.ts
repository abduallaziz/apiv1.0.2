import { Injectable } from '@nestjs/common';
import {
  StockRepository,
  StockLevelFilter,
  StockLevelEnrichedFilter,
  MovementsLedgerFilter,
} from './repositories/stock.repository';

@Injectable()
export class StockService {
  constructor(private readonly stockRepo: StockRepository) {}

  findLevels(tenantId: string, filter: StockLevelFilter) {
    return this.stockRepo.findLevels(tenantId, filter);
  }

  findLevelsEnriched(tenantId: string, filter: StockLevelEnrichedFilter) {
    return this.stockRepo.findLevelsEnriched(tenantId, filter);
  }

  findMovementsLedger(tenantId: string, filter: MovementsLedgerFilter, page = 1, perPage = 50) {
    return this.stockRepo.findMovementsLedger(tenantId, filter, page, perPage);
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
