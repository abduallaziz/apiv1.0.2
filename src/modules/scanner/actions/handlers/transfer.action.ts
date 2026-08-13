import { Injectable, BadRequestException } from '@nestjs/common';
import { TransfersService } from '../../../inventory/transfers.service';
import { ActionRequest, IActionHandler } from '../action.types';

// Scanning an item at the receiving warehouse confirms arrival of an
// in-transit transfer — TransfersService.receive is header-level (the
// transfer's lines/quantities were fixed when it was dispatched), same
// shape as ReceivingAction's relationship to goods receipts.
@Injectable()
export class TransferAction implements IActionHandler {
  constructor(private readonly transfersService: TransfersService) {}

  async execute(request: ActionRequest): Promise<Record<string, unknown>> {
    const transferId = request.workflowContext.transfer_id;
    if (!transferId) {
      throw new BadRequestException(
        'transfer action requires workflowContext.transfer_id',
      );
    }
    return this.transfersService.receive(
      transferId,
      request.tenantId,
      request.actorId,
    ) as Promise<Record<string, unknown>>;
  }
}
