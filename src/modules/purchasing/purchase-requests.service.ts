import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PurchaseRequestsRepository } from './repositories/purchase-requests.repository';
import { PaginationDto } from '../../shared/dto/pagination.dto';
import { CreatePurchaseRequestDto } from './dto/create-purchase-request.dto';
import { UpdatePurchaseRequestDto } from './dto/update-purchase-request.dto';
import { RejectPurchaseRequestDto } from './dto/reject-purchase-request.dto';
import { ConvertSuggestionsDto } from './dto/convert-suggestions.dto';
import { ApprovalEngine } from '../../engines/approval-engine/approval.engine';
import { ApprovalHistoryRepository } from '../../engines/approval-engine/approval-history.repository';

const PR_REFERENCE_TYPE = 'purchase_request';
const PR_PENDING_STATUS = 'submitted' as const;

@Injectable()
export class PurchaseRequestsService {
  constructor(
    private readonly purchaseRequestsRepo: PurchaseRequestsRepository,
    private readonly approvalEngine: ApprovalEngine,
    private readonly approvalHistory: ApprovalHistoryRepository,
  ) {}

  async findAll(
    tenantId: string,
    status?: string,
    page?: string,
    perPage?: string,
  ) {
    return this.purchaseRequestsRepo.findAll(
      tenantId,
      status,
      new PaginationDto(page, perPage),
    );
  }

  async findById(id: string, tenantId: string) {
    const pr: any = await this.purchaseRequestsRepo.findById(id, tenantId);
    if (!pr) throw new NotFoundException('Purchase request not found');
    return {
      ...pr,
      branch_name: pr.branches?.name ?? null,
      warehouse_name: pr.warehouses?.name ?? null,
      items: (pr.items ?? []).map((item: any) => ({
        ...item,
        item_name: item.items?.name ?? null,
      })),
    };
  }

  async create(
    tenantId: string,
    dto: CreatePurchaseRequestDto,
    requestedBy: string,
  ) {
    const { items, ...header } = dto;
    return this.purchaseRequestsRepo.create(
      tenantId,
      {
        branch_id: header.branch_id ?? null,
        warehouse_id: header.warehouse_id ?? null,
        request_number: header.request_number,
        notes: header.notes ?? null,
      },
      items.map((line) => ({
        item_id: line.item_id,
        variant_id: line.variant_id ?? null,
        quantity_requested: line.quantity_requested,
        notes: line.notes ?? null,
      })),
      requestedBy,
    );
  }

  // Planning workflow: Stock Risk -> Purchase Suggestion -> User Review -> Purchase Request.
  // Reuses create() exactly (same DTO shape, same repository path) so a
  // suggestion-originated request has no separate code path or state
  // machine from a manually-authored one.
  async createFromSuggestions(
    tenantId: string,
    dto: ConvertSuggestionsDto,
    requestedBy: string,
  ) {
    const requestNumber = `PR-SUGG-${Date.now()}`;
    return this.create(
      tenantId,
      {
        branch_id: dto.branch_id,
        warehouse_id: dto.warehouse_id,
        request_number: requestNumber,
        notes: dto.notes ?? 'Generated from purchase suggestions',
        items: dto.items,
      },
      requestedBy,
    );
  }

  async update(id: string, tenantId: string, dto: UpdatePurchaseRequestDto) {
    const pr = await this.findById(id, tenantId);
    if (pr.status !== 'draft') {
      throw new ForbiddenException(
        'Only draft purchase requests can be edited',
      );
    }
    return this.purchaseRequestsRepo.update(id, tenantId, { ...dto });
  }

  async submit(id: string, tenantId: string, actorId: string) {
    const pr = await this.findById(id, tenantId);
    const result = await this.purchaseRequestsRepo.submit(id, tenantId);
    await this.approvalHistory.record({
      tenantId,
      referenceType: PR_REFERENCE_TYPE,
      referenceId: id,
      action: 'submitted',
      actorId,
      previousStatus: pr.status,
      newStatus: 'submitted',
    });
    return result;
  }

  async approve(id: string, tenantId: string, approvedBy: string) {
    const pr = await this.findById(id, tenantId);
    if (!this.approvalEngine.canApprove(pr.status, PR_PENDING_STATUS)) {
      throw new BadRequestException(
        `Cannot approve purchase request with status: ${pr.status}`,
      );
    }
    const result = this.approvalEngine.approve(approvedBy);
    const updated = await this.purchaseRequestsRepo.approve(
      id,
      tenantId,
      result.resolvedBy,
      result.resolvedAt,
    );
    await this.approvalHistory.record({
      tenantId,
      referenceType: PR_REFERENCE_TYPE,
      referenceId: id,
      action: 'approved',
      actorId: approvedBy,
      previousStatus: pr.status,
      newStatus: 'approved',
    });
    return updated;
  }

  async reject(
    id: string,
    tenantId: string,
    rejectedBy: string,
    dto: RejectPurchaseRequestDto,
  ) {
    const pr = await this.findById(id, tenantId);
    if (!this.approvalEngine.canReject(pr.status, PR_PENDING_STATUS)) {
      throw new BadRequestException(
        `Cannot reject purchase request with status: ${pr.status}`,
      );
    }
    const result = this.approvalEngine.reject(rejectedBy, dto.reason);
    const note = pr.notes
      ? `${pr.notes} | Rejected: ${result.reason}`
      : `Rejected: ${result.reason}`;
    const updated = await this.purchaseRequestsRepo.reject(
      id,
      tenantId,
      result.resolvedBy,
      result.resolvedAt,
      note,
    );
    await this.approvalHistory.record({
      tenantId,
      referenceType: PR_REFERENCE_TYPE,
      referenceId: id,
      action: 'rejected',
      actorId: rejectedBy,
      previousStatus: pr.status,
      newStatus: 'rejected',
      reason: result.reason,
    });
    return updated;
  }

  async cancel(id: string, tenantId: string, actorId: string) {
    const pr = await this.findById(id, tenantId);
    const result = await this.purchaseRequestsRepo.cancel(id, tenantId);
    await this.approvalHistory.record({
      tenantId,
      referenceType: PR_REFERENCE_TYPE,
      referenceId: id,
      action: 'cancelled',
      actorId,
      previousStatus: pr.status,
      newStatus: 'cancelled',
    });
    return result;
  }

  async remove(id: string, tenantId: string) {
    const pr = await this.findById(id, tenantId);
    if (pr.status !== 'draft') {
      throw new ForbiddenException(
        'Only draft purchase requests can be deleted',
      );
    }
    await this.purchaseRequestsRepo.softDelete(id, tenantId);
  }

  async history(id: string, tenantId: string) {
    await this.findById(id, tenantId);
    return this.approvalHistory.findForReference(
      tenantId,
      PR_REFERENCE_TYPE,
      id,
    );
  }
}
