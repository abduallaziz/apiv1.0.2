import { Injectable, NotFoundException } from '@nestjs/common';
import { ScrapRepository } from './repositories/scrap.repository';
import { ProductionOrdersRepository } from './repositories/production-orders.repository';
import { WarehousesService } from '../inventory/warehouses.service';
import { AuditService } from '../../core/audit/audit.service';
import { CreateScrapDto } from './dto/create-scrap.dto';
import { throwFromRpcError } from '../inventory/rpc-error.util';

@Injectable()
export class ScrapService {
  constructor(
    private readonly scrapRepo: ScrapRepository,
    private readonly productionOrdersRepo: ProductionOrdersRepository,
    private readonly warehousesService: WarehousesService,
    private readonly auditService: AuditService,
  ) {}

  // Branch System Step 5 (Owner-approved) — see the identical helper in
  // ProductionOrdersService for the full rationale.
  private async resolveBranchForWarehouse(
    warehouseId: string,
    tenantId: string,
  ): Promise<string | null> {
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

  private async findOrder(productionOrderId: string, tenantId: string) {
    const order = await this.productionOrdersRepo.findById(
      productionOrderId,
      tenantId,
    );
    if (!order) throw new NotFoundException('Production order not found');
    return order;
  }

  findByProductionOrder(productionOrderId: string, tenantId: string) {
    return this.scrapRepo.findByProductionOrder(productionOrderId, tenantId);
  }

  async record(
    productionOrderId: string,
    tenantId: string,
    actorId: string | null,
    dto: CreateScrapDto,
  ) {
    const order = await this.findOrder(productionOrderId, tenantId);
    try {
      const scrap = await this.scrapRepo.record(
        tenantId,
        order.warehouse_id,
        productionOrderId,
        dto.item_id,
        dto.variant_id ?? null,
        dto.quantity,
        dto.reason ?? null,
        actorId,
      );

      if (actorId) {
        await this.auditService
          .log({
            tenant_id: tenantId,
            actor_id: actorId,
            action: 'production_order.scrap_recorded',
            resource_type: 'production_order',
            resource_id: productionOrderId,
            branch_id: await this.resolveBranchForWarehouse(
              order.warehouse_id,
              tenantId,
            ),
          })
          .catch(() => {});
      }

      return scrap;
    } catch (error) {
      throwFromRpcError(error as { message: string; code?: string });
    }
  }
}
