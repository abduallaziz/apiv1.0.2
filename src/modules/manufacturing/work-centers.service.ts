import { Injectable, NotFoundException } from '@nestjs/common';
import { WorkCentersRepository } from './repositories/work-centers.repository';
import { WarehousesService } from '../inventory/warehouses.service';
import { AuditService } from '../../core/audit/audit.service';
import { CreateWorkCenterDto } from './dto/create-work-center.dto';
import { UpdateWorkCenterDto } from './dto/update-work-center.dto';

@Injectable()
export class WorkCentersService {
  constructor(
    private readonly workCentersRepo: WorkCentersRepository,
    private readonly warehousesService: WarehousesService,
    private readonly auditService: AuditService,
  ) {}

  // Branch System Step 5 (Owner-approved) — see identical helper in
  // ProductionOrdersService. work_centers.warehouse_id is nullable, so this
  // correctly returns null for a work center with no warehouse link.
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

  findAll(tenantId: string) {
    return this.workCentersRepo.findAll(tenantId);
  }

  async findById(id: string, tenantId: string) {
    const workCenter = await this.workCentersRepo.findById(id, tenantId);
    if (!workCenter) throw new NotFoundException('Work center not found');
    return workCenter;
  }

  async create(tenantId: string, dto: CreateWorkCenterDto, actorId: string) {
    if (dto.warehouse_id) {
      await this.warehousesService.findById(dto.warehouse_id, tenantId); // throws NotFoundException if missing
    }
    const created = await this.workCentersRepo.create(tenantId, {
      name: dto.name,
      warehouse_id: dto.warehouse_id ?? null,
      is_active: dto.is_active ?? true,
    });

    await this.auditService
      .log({
        tenant_id: tenantId,
        actor_id: actorId,
        action: 'work_center.created',
        resource_type: 'work_center',
        resource_id: (created as { id?: string })?.id,
        branch_id: await this.resolveBranchForWarehouse(
          dto.warehouse_id,
          tenantId,
        ),
      })
      .catch(() => {});

    return created;
  }

  async update(
    id: string,
    tenantId: string,
    dto: UpdateWorkCenterDto,
    actorId: string,
  ) {
    await this.findById(id, tenantId);
    if (dto.warehouse_id) {
      await this.warehousesService.findById(dto.warehouse_id, tenantId);
    }
    const updated = await this.workCentersRepo.update(id, tenantId, {
      ...dto,
    });

    await this.auditService
      .log({
        tenant_id: tenantId,
        actor_id: actorId,
        action: 'work_center.updated',
        resource_type: 'work_center',
        resource_id: id,
        branch_id: await this.resolveBranchForWarehouse(
          (updated as { warehouse_id?: string | null })?.warehouse_id,
          tenantId,
        ),
      })
      .catch(() => {});

    return updated;
  }

  async activate(id: string, tenantId: string, actorId: string) {
    const existing = await this.findById(id, tenantId);
    const result = await this.workCentersRepo.setActive(id, tenantId, true);

    await this.auditService
      .log({
        tenant_id: tenantId,
        actor_id: actorId,
        action: 'work_center.activated',
        resource_type: 'work_center',
        resource_id: id,
        branch_id: await this.resolveBranchForWarehouse(
          (existing as { warehouse_id?: string | null })?.warehouse_id,
          tenantId,
        ),
      })
      .catch(() => {});

    return result;
  }

  async deactivate(id: string, tenantId: string, actorId: string) {
    const existing = await this.findById(id, tenantId);
    const result = await this.workCentersRepo.setActive(id, tenantId, false);

    await this.auditService
      .log({
        tenant_id: tenantId,
        actor_id: actorId,
        action: 'work_center.deactivated',
        resource_type: 'work_center',
        resource_id: id,
        branch_id: await this.resolveBranchForWarehouse(
          (existing as { warehouse_id?: string | null })?.warehouse_id,
          tenantId,
        ),
      })
      .catch(() => {});

    return result;
  }
}
