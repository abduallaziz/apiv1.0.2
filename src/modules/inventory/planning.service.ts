import { Injectable } from '@nestjs/common';
import { PlanningRepository } from './repositories/planning.repository';

@Injectable()
export class PlanningService {
  constructor(private readonly planningRepo: PlanningRepository) {}

  calculateDemandForecast(
    tenantId: string,
    warehouseId: string,
    itemId: string,
    variantId?: string,
    lookbackDays?: number,
  ) {
    return this.planningRepo.calculateDemandForecast(tenantId, warehouseId, itemId, variantId, lookbackDays);
  }

  purchaseSuggestions(tenantId: string) {
    return this.planningRepo.purchaseSuggestions(tenantId);
  }

  calculateSafetyStock(
    tenantId: string,
    warehouseId: string,
    itemId: string,
    variantId?: string,
    lookbackDays?: number,
  ) {
    return this.planningRepo.calculateSafetyStock(
      tenantId,
      warehouseId,
      itemId,
      variantId,
      lookbackDays,
    );
  }
}
