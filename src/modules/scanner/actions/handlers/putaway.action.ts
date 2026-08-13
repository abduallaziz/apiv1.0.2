import { Injectable, BadRequestException } from '@nestjs/common';
import { WarehouseTasksService } from '../../../inventory/warehouse-tasks.service';
import { ActionRequest, IActionHandler } from '../action.types';

// The worker scans the destination location's code to confirm placement;
// the resolved location id IS the confirmed_location_id WarehouseTasks
// Service.confirm expects — that binding is the entire point of this
// action existing, not a business rule of its own.
@Injectable()
export class PutawayAction implements IActionHandler {
  constructor(private readonly warehouseTasksService: WarehouseTasksService) {}

  async execute(request: ActionRequest): Promise<Record<string, unknown>> {
    const { task_id: taskId, quantity } = request.workflowContext;
    if (!taskId || quantity === undefined) {
      throw new BadRequestException(
        'putaway action requires workflowContext.task_id and quantity',
      );
    }
    if (
      request.resolution.entity_type !== 'location' ||
      !request.resolution.entity_id
    ) {
      throw new BadRequestException(
        'putaway action requires a resolved location',
      );
    }
    return this.warehouseTasksService.confirm(
      taskId,
      request.tenantId,
      quantity,
      request.resolution.entity_id,
      request.actorId,
    ) as Promise<Record<string, unknown>>;
  }
}
