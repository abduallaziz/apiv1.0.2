import { Injectable, BadRequestException } from '@nestjs/common';
import { CountsService } from '../../../inventory/counts.service';
import { ActionRequest, IActionHandler } from '../action.types';

@Injectable()
export class CountingAction implements IActionHandler {
  constructor(private readonly countsService: CountsService) {}

  async execute(request: ActionRequest): Promise<Record<string, unknown>> {
    const {
      count_id: countId,
      count_item_id: countItemId,
      quantity,
    } = request.workflowContext;
    if (!countId || !countItemId || quantity === undefined) {
      throw new BadRequestException(
        'counting action requires workflowContext.count_id, count_item_id and quantity',
      );
    }
    return this.countsService.submitCount(
      countId,
      countItemId,
      request.tenantId,
      { counted_quantity: quantity },
    ) as Promise<Record<string, unknown>>;
  }
}
