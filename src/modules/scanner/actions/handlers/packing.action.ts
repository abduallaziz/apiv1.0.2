import { Injectable, BadRequestException } from '@nestjs/common';
import { WmsService } from '../../../inventory/wms.service';
import { ActionRequest, IActionHandler } from '../action.types';

@Injectable()
export class PackingAction implements IActionHandler {
  constructor(private readonly wmsService: WmsService) {}

  async execute(request: ActionRequest): Promise<Record<string, unknown>> {
    const { shipment_line_id: lineId, quantity } = request.workflowContext;
    if (!lineId || quantity === undefined) {
      throw new BadRequestException(
        'packing action requires workflowContext.shipment_line_id and quantity',
      );
    }
    return this.wmsService.confirmPack(
      lineId,
      request.tenantId,
      quantity,
      request.actorId,
    ) as Promise<Record<string, unknown>>;
  }
}
