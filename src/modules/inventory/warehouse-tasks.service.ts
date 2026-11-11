import { Injectable, NotFoundException } from '@nestjs/common';
import { WarehouseTasksRepository } from './repositories/warehouse-tasks.repository';
import { CreateWarehouseTaskDto } from './dto/create-warehouse-task.dto';
import { WarehousesService } from './warehouses.service';
import { AuditService } from '../../core/audit/audit.service';
import { WarehouseTasksQueryDto } from './dto/wms-list-query.dto';

@Injectable()
export class WarehouseTasksService {
  constructor(
    private readonly tasksRepo: WarehouseTasksRepository,
    private readonly warehousesService: WarehousesService,
    private readonly auditService: AuditService,
  ) {}

  // Branch System Step 5 (Owner-approved) — see identical helper in
  // ProductionOrdersService. warehouse_id is required on task creation, but
  // this stays null-safe like every other instance of this pattern.
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

  findAll(
    tenantId: string,
    taskType?: string,
    status?: string,
    assignedTo?: string,
  ): unknown;
  findAll(tenantId: string, query: WarehouseTasksQueryDto): unknown;
  findAll(
    tenantId: string,
    arg2?: string | WarehouseTasksQueryDto,
    arg3?: string,
    arg4?: string,
  ) {
    if (typeof arg2 === 'object') {
      return this.tasksRepo.findAll(tenantId, arg2);
    }
    return this.tasksRepo.findAll(tenantId, arg2, arg3, arg4);
  }

  async findById(id: string, tenantId: string) {
    const task = await this.tasksRepo.findById(id, tenantId);
    if (!task) throw new NotFoundException('Warehouse task not found');
    return task;
  }

  history(id: string, tenantId: string) {
    return this.tasksRepo.findHistory(tenantId, id);
  }

  async create(
    tenantId: string,
    dto: CreateWarehouseTaskDto,
    createdBy: string,
  ) {
    const task = await this.tasksRepo.createManual(tenantId, {
      warehouse_id: dto.warehouse_id,
      task_type: dto.task_type,
      item_id: dto.item_id,
      variant_id: dto.variant_id ?? null,
      batch_id: dto.batch_id ?? null,
      quantity: dto.quantity,
      source_location_id: dto.source_location_id ?? null,
      suggested_location_id: dto.suggested_location_id ?? null,
      priority: dto.priority ?? 'medium',
      source_document_type: dto.source_document_type ?? 'manual',
      source_document_id: dto.source_document_id ?? null,
      created_by: createdBy,
    });

    await this.auditService
      .log({
        tenant_id: tenantId,
        actor_id: createdBy,
        action: 'warehouse_task.created',
        resource_type: 'warehouse_task',
        resource_id: (task as { id?: string })?.id,
        branch_id: await this.resolveBranchForWarehouse(
          dto.warehouse_id,
          tenantId,
        ),
      })
      .catch(() => {});

    return task;
  }

  async assign(
    id: string,
    tenantId: string,
    assignedTo: string,
    actorId: string,
  ) {
    const existing = await this.findById(id, tenantId);
    const result = await this.tasksRepo.assign(
      id,
      tenantId,
      assignedTo,
      actorId,
    );

    await this.auditService
      .log({
        tenant_id: tenantId,
        actor_id: actorId,
        action: 'warehouse_task.assigned',
        resource_type: 'warehouse_task',
        resource_id: id,
        branch_id: await this.resolveBranchForWarehouse(
          (existing as { warehouse_id?: string | null })?.warehouse_id,
          tenantId,
        ),
      })
      .catch(() => {});

    return result;
  }

  async confirm(
    id: string,
    tenantId: string,
    quantity: number,
    confirmedLocationId: string,
    actorId: string,
  ) {
    const existing = await this.findById(id, tenantId);
    const result = await this.tasksRepo.confirm(
      id,
      tenantId,
      quantity,
      confirmedLocationId,
      actorId,
    );

    await this.auditService
      .log({
        tenant_id: tenantId,
        actor_id: actorId,
        action: 'warehouse_task.confirmed',
        resource_type: 'warehouse_task',
        resource_id: id,
        branch_id: await this.resolveBranchForWarehouse(
          (existing as { warehouse_id?: string | null })?.warehouse_id,
          tenantId,
        ),
      })
      .catch(() => {});

    return result;
  }

  // Inventory #7 / 7-1 (Owner-approved) — cancel() was the one warehouse-
  // task action with no audit_logs entry (create/assign/confirm all had
  // one already); a genuine gap directly within this item's exact scope
  // ("shared status-history + audit-logs wiring"), fixed here rather than
  // left for a later pass.
  async cancel(id: string, tenantId: string, actorId: string) {
    const existing = await this.findById(id, tenantId);
    const result = await this.tasksRepo.cancel(id, tenantId, actorId);

    await this.auditService
      .log({
        tenant_id: tenantId,
        actor_id: actorId,
        action: 'warehouse_task.cancelled',
        resource_type: 'warehouse_task',
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
