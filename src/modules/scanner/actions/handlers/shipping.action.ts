import { Injectable, BadRequestException } from '@nestjs/common';
import { WmsService } from '../../../inventory/wms.service';
import { ActionRequest, IActionHandler } from '../action.types';

// Shipping is dock-door/vehicle confirmation, not an item-level scan —
// the resolved entity (typically a location scan at the dock) is not
// forwarded to shipShipment at all, since that method takes no item/
// location argument; the scan here is a workflow-intent trigger, and
// tracking_number (if scanned/typed) passes straight through.
@Injectable()
export class ShippingAction implements IActionHandler {
  constructor(private readonly wmsService: WmsService) {}

  async execute(request: ActionRequest): Promise<Record<string, unknown>> {
    const { shipment_id: shipmentId, tracking_number: trackingNumber } =
      request.workflowContext;
    if (!shipmentId) {
      throw new BadRequestException(
        'shipping action requires workflowContext.shipment_id',
      );
    }
    return this.wmsService.shipShipment(
      shipmentId,
      request.tenantId,
      request.actorId,
      trackingNumber,
    ) as Promise<Record<string, unknown>>;
  }
}
