import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CountsRepository } from './repositories/counts.repository';
import { PaginationDto } from '../../shared/dto/pagination.dto';
import { CreateStockCountDto } from './dto/create-stock-count.dto';
import { SubmitCountItemDto } from './dto/submit-count-item.dto';
import { ApproveStockCountDto } from './dto/approve-stock-count.dto';
import { throwFromRpcError } from './rpc-error.util';
import { StockService } from './stock.service';
import { ApprovalEngine } from '../../engines/approval-engine/approval.engine';
import { ApprovalHistoryRepository } from '../../engines/approval-engine/approval-history.repository';

@Injectable()
export class CountsService {
  private readonly approvalThreshold: number;

  constructor(
    private readonly countsRepo: CountsRepository,
    private readonly stockService: StockService,
    private readonly approvalEngine: ApprovalEngine,
    private readonly approvalHistory: ApprovalHistoryRepository,
    private readonly config: ConfigService,
  ) {
    // Same pattern as AdjustmentsService — 0/unset means approval is never
    // required, preserving today's unconditional finalize for every tenant
    // that hasn't opted in.
    this.approvalThreshold = Number(
      this.config.get<string>('INVENTORY_COUNT_APPROVAL_THRESHOLD') ?? '0',
    );
  }

  async findAll(
    tenantId: string,
    status?: string,
    page?: string,
    perPage?: string,
  ) {
    return (
      (await this.countsRepo.findAll(
        tenantId,
        status,
        new PaginationDto(page, perPage),
      )) ?? []
    );
  }

  async findById(id: string, tenantId: string) {
    const count: any = await this.countsRepo.findById(id, tenantId);
    if (!count) throw new NotFoundException('Stock count not found');
    return {
      ...count,
      warehouse_name: count.warehouses?.name ?? null,
      items: (count.items ?? []).map((item: any) => ({
        ...item,
        item_name: item.items?.name ?? null,
        location_code: item.warehouse_locations?.code ?? null,
        location_name: item.warehouse_locations?.name ?? null,
      })),
    };
  }

  create(tenantId: string, dto: CreateStockCountDto, actorId: string) {
    if (
      dto.count_type &&
      dto.count_type !== 'full' &&
      !dto.item_ids?.length &&
      !dto.location_ids?.length
    ) {
      throw new BadRequestException(
        `count_type "${dto.count_type}" requires at least one of item_ids or location_ids to scope the count`,
      );
    }

    return this.countsRepo.create(
      tenantId,
      {
        warehouse_id: dto.warehouse_id,
        count_number: dto.count_number,
        notes: dto.notes ?? null,
        ...(dto.count_type ? { count_type: dto.count_type } : {}),
      },
      actorId,
      { itemIds: dto.item_ids, locationIds: dto.location_ids },
    );
  }

  async submitCount(
    countId: string,
    countItemId: string,
    tenantId: string,
    dto: SubmitCountItemDto,
  ) {
    await this.findById(countId, tenantId);

    if (dto.reason_code_id) {
      const exists = await this.countsRepo.reasonCodeExists(
        dto.reason_code_id,
        tenantId,
      );
      if (!exists) throw new NotFoundException('Reason code not found');
    }

    return this.countsRepo.submitCount(
      countItemId,
      tenantId,
      dto.counted_quantity,
      dto.reason_code_id,
    );
  }

  async finalize(id: string, tenantId: string, actorId: string) {
    const count: any = await this.findById(id, tenantId);

    // Only decide approval requirement once, the first time finalize is
    // attempted for a count that hasn't opted into approval yet (NULL).
    // A count already 'pending_approval'/'rejected'/'approved' falls
    // straight through to the RPC, whose own guard (migration 107,
    // unchanged) is the single source of truth for whether finalize is
    // allowed — this only decides whether to flip a NULL count into
    // 'pending_approval' in the first place.
    if (count.approval_status === null || count.approval_status === undefined) {
      if (this.approvalThreshold > 0) {
        const varianceValue = await this.countsRepo.computeTotalVarianceValue(
          id,
          tenantId,
        );
        if (varianceValue >= this.approvalThreshold) {
          await this.countsRepo.setPendingApproval(id, tenantId);
          throw new BadRequestException(
            `Stock count ${id} requires approval before finalizing (variance value ${varianceValue} >= threshold ${this.approvalThreshold})`,
          );
        }
      }
    }

    try {
      const result = await this.countsRepo.finalize(id, actorId);
      await this.stockService.invalidateStockCache(tenantId);
      return result;
    } catch (error) {
      throwFromRpcError(error as { message: string; code?: string });
    }
  }

  // Migration 11.1c-fix — fn_approve_stock_count (107) is unmodified and
  // does not itself write to approval_history; this method adds the
  // ApprovalEngine guard + approval_history record around it, matching the
  // exact pattern already used by Quality Holds (holds.service.ts) and
  // Purchasing (amendments/purchase-orders/etc. .service.ts): the RPC
  // performs the actual state transition, the TS layer owns the shared
  // decision ledger entry.
  async approve(
    id: string,
    tenantId: string,
    actorId: string,
    dto: ApproveStockCountDto,
  ) {
    const count: any = await this.findById(id, tenantId);
    const pendingStatus = 'pending_approval';

    if (dto.approved) {
      if (
        !this.approvalEngine.canApprove(count.approval_status, pendingStatus)
      ) {
        throw new BadRequestException(
          `Stock count ${id} is not pending approval (approval_status=${count.approval_status})`,
        );
      }
      const result = this.approvalEngine.approve(actorId);
      let updated;
      try {
        updated = await this.countsRepo.approve(id, actorId, true);
      } catch (error) {
        throwFromRpcError(error as { message: string; code?: string });
      }
      await this.approvalHistory.record({
        tenantId,
        referenceType: 'stock_count',
        referenceId: id,
        action: 'approve',
        actorId: result.resolvedBy,
        previousStatus: pendingStatus,
        newStatus: 'approved',
        reason: dto.reason,
      });
      return updated;
    }

    if (!this.approvalEngine.canReject(count.approval_status, pendingStatus)) {
      throw new BadRequestException(
        `Stock count ${id} is not pending approval (approval_status=${count.approval_status})`,
      );
    }
    const result = this.approvalEngine.reject(actorId, dto.reason ?? ''); // throws if reason empty
    let updated;
    try {
      updated = await this.countsRepo.approve(id, actorId, false);
    } catch (error) {
      throwFromRpcError(error as { message: string; code?: string });
    }
    await this.approvalHistory.record({
      tenantId,
      referenceType: 'stock_count',
      referenceId: id,
      action: 'reject',
      actorId: result.resolvedBy,
      previousStatus: pendingStatus,
      newStatus: 'rejected',
      reason: result.reason,
    });
    return updated;
  }
}
