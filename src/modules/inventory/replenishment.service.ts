import { Injectable } from '@nestjs/common';
import { ReplenishmentRepository } from './repositories/replenishment.repository';
import { CreateReplenishmentRuleDto } from './dto/create-replenishment-rule.dto';

@Injectable()
export class ReplenishmentService {
  constructor(private readonly replenishmentRepo: ReplenishmentRepository) {}

  findAllRules(tenantId: string) {
    return this.replenishmentRepo.findAllRules(tenantId);
  }

  createRule(tenantId: string, dto: CreateReplenishmentRuleDto) {
    return this.replenishmentRepo.createRule(tenantId, {
      warehouse_id: dto.warehouse_id,
      item_id: dto.item_id,
      variant_id: dto.variant_id ?? null,
      destination_location_id: dto.destination_location_id,
      source_location_id: dto.source_location_id,
      min_quantity: dto.min_quantity,
      max_quantity: dto.max_quantity,
    });
  }

  runCheck(tenantId: string, warehouseId: string, actorId: string | null) {
    return this.replenishmentRepo.runCheck(tenantId, warehouseId, actorId);
  }
}
