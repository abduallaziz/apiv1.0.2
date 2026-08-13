import { Injectable, BadRequestException } from '@nestjs/common';
import { GoodsReceiptsService } from '../../../purchasing/goods-receipts.service';
import { ActionRequest, IActionHandler } from '../action.types';

// Maps a scan confirming a received item to GoodsReceiptsService.post —
// the receipt itself (which lines, quantities, warehouse) was already
// created by the existing Purchasing flow; the scan-triggered action only
// posts it, exactly like GoodsReceiptsController does today.
@Injectable()
export class ReceivingAction implements IActionHandler {
  constructor(private readonly goodsReceiptsService: GoodsReceiptsService) {}

  async execute(request: ActionRequest): Promise<Record<string, unknown>> {
    const receiptId = request.workflowContext.receipt_id;
    if (!receiptId) {
      throw new BadRequestException(
        'receiving action requires workflowContext.receipt_id',
      );
    }
    return this.goodsReceiptsService.post(
      receiptId,
      request.tenantId,
      request.actorId,
    ) as Promise<Record<string, unknown>>;
  }
}
