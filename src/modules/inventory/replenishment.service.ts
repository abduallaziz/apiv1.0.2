import { Injectable } from '@nestjs/common';
import { ReplenishmentRepository } from './repositories/replenishment.repository';
import { CreateReplenishmentRuleDto } from './dto/create-replenishment-rule.dto';
import { WarehousesService } from './warehouses.service';
import { AuditService } from '../../core/audit/audit.service';

@Injectable()
export class ReplenishmentService {
  constructor(
    private readonly replenishmentRepo: ReplenishmentRepository,
    private readonly warehousesService: WarehousesService,
    private readonly auditService: AuditService,
  ) {}

  // Branch System Step 5 (Owner-approved) — see identical helper in
  // ProductionOrdersService. warehouse_id is required on this DTO, but this
  // stays null-safe like every other instance of this pattern.
  private async resolveBranchForWarehouse(
    warehouseId: string | null | undefined,
    tenantId: string,
  ): Promise<string | null> {
    if (!warehouseId) return null;
    try {
      const warehouse = await this.warehousesService.findById(
        warehouseId,
        tenantId,
      );
      return warehouse?.branch_id ?? null;
    } catch {
      return null;
    }
  }

  findAllRules(tenantId: string) {
    return this.replenishmentRepo.findAllRules(tenantId);
  }

  async createRule(
    tenantId: string,
    dto: CreateReplenishmentRuleDto,
    actorId: string,
  ) {
    const rule = await this.replenishmentRepo.createRule(tenantId, {
      warehouse_id: dto.warehouse_id,
      item_id: dto.item_id,
      variant_id: dto.variant_id ?? null,
      destination_location_id: dto.destination_location_id,
      source_location_id: dto.source_location_id,
      min_quantity: dto.min_quantity,
      max_quantity: dto.max_quantity,
    });

    await this.auditService
      .log({
        tenant_id: tenantId,
        actor_id: actorId,
        action: 'replenishment_rule.created',
        resource_type: 'replenishment_rule',
        resource_id: (rule as { id?: string })?.id,
        branch_id: await this.resolveBranchForWarehouse(
          dto.warehouse_id,
          tenantId,
        ),
      })
      .catch(() => {});

    return rule;
  }

  runCheck(tenantId: string, warehouseId: string, actorId: string | null) {
    return this.replenishmentRepo.runCheck(tenantId, warehouseId, actorId);
  }
}
