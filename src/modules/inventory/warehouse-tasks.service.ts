import { Injectable, NotFoundException } from '@nestjs/common';
import { WarehouseTasksRepository } from './repositories/warehouse-tasks.repository';
import { CreateWarehouseTaskDto } from './dto/create-warehouse-task.dto';

@Injectable()
export class WarehouseTasksService {
  constructor(private readonly tasksRepo: WarehouseTasksRepository) {}

  findAll(tenantId: string, taskType?: string, status?: string, assignedTo?: string) {
    return this.tasksRepo.findAll(tenantId, taskType, status, assignedTo);
  }

  async findById(id: string, tenantId: string) {
    const task = await this.tasksRepo.findById(id, tenantId);
    if (!task) throw new NotFoundException('Warehouse task not found');
    return task;
  }

  history(id: string, tenantId: string) {
    return this.tasksRepo.findHistory(tenantId, id);
  }

  create(tenantId: string, dto: CreateWarehouseTaskDto, createdBy: string) {
    return this.tasksRepo.createManual(tenantId, {
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
  }

  assign(id: string, tenantId: string, assignedTo: string, actorId: string) {
    return this.tasksRepo.assign(id, tenantId, assignedTo, actorId);
  }

  confirm(id: string, tenantId: string, quantity: number, confirmedLocationId: string, actorId: string) {
    return this.tasksRepo.confirm(id, tenantId, quantity, confirmedLocationId, actorId);
  }

  cancel(id: string, tenantId: string, actorId: string) {
    return this.tasksRepo.cancel(id, tenantId, actorId);
  }
}
