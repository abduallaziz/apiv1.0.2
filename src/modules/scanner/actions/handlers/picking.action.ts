import { Injectable, BadRequestException } from '@nestjs/common';
import { WmsService } from '../../../inventory/wms.service';
import { ActionRequest, IActionHandler } from '../action.types';

// Scanning an item/variant/batch/serial confirms a pick against the
// pick_list_line_id already known from the active picking session; when
// the scan resolved to a batch, its id is forwarded as WmsService.
// confirmPick's own batch_id param (the same FEFO/batch-required
// validation from migration 171 runs exactly as it does for a manually
// typed batch id — nothing about that validation is re-implemented here).
@Injectable()
export class PickingAction implements IActionHandler {
  constructor(private readonly wmsService: WmsService) {}

  async execute(request: ActionRequest): Promise<Record<string, unknown>> {
    const { pick_list_line_id: lineId, quantity } = request.workflowContext;
    if (!lineId || quantity === undefined) {
      throw new BadRequestException(
        'picking action requires workflowContext.pick_list_line_id and quantity',
      );
    }
    const batchId =
      request.resolution.entity_type === 'batch'
        ? (request.resolution.entity_id ?? undefined)
        : undefined;
    return this.wmsService.confirmPick(
      lineId,
      request.tenantId,
      quantity,
      request.actorId,
      batchId,
    ) as Promise<Record<string, unknown>>;
  }
}
