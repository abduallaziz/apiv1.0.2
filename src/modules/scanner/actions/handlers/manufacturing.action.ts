import { Injectable, BadRequestException } from '@nestjs/common';
import { ProductionOrdersService } from '../../../manufacturing/production-orders.service';
import { ActionRequest, IActionHandler } from '../action.types';

// "Only if existing service is available" (per the approved scope) —
// ProductionOrdersService.complete() exists and is the closest
// scan-triggered fit: a worker scanning the finished-good barcode to
// close out a production order, with quantity_produced coming from the
// scan/workflow context. Per-component material-issue-by-scan (a finer-
// grained action than order completion) is not implemented — no existing
// Sefay service exposes a standalone "issue one material line" method to
// map onto; documented as a Phase 8+ candidate if that granularity is
// ever requested, not invented here.
@Injectable()
export class ManufacturingAction implements IActionHandler {
  constructor(
    private readonly productionOrdersService: ProductionOrdersService,
  ) {}

  async execute(request: ActionRequest): Promise<Record<string, unknown>> {
    const { production_order_id: orderId, quantity } = request.workflowContext;
    if (!orderId) {
      throw new BadRequestException(
        'manufacturing action requires workflowContext.production_order_id',
      );
    }
    return this.productionOrdersService.complete(
      orderId,
      request.tenantId,
      request.actorId,
      { quantity_produced: quantity },
    ) as Promise<Record<string, unknown>>;
  }
}
