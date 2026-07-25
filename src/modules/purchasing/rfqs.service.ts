import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RfqsRepository } from './repositories/rfqs.repository';
import { PaginationDto } from '../../shared/dto/pagination.dto';
import { CreateRfqDto } from './dto/create-rfq.dto';
import { UpdateRfqDto } from './dto/update-rfq.dto';
import { RejectRfqDto } from './dto/reject-rfq.dto';
import { ApprovalEngine } from '../../engines/approval-engine/approval.engine';
import { ApprovalHistoryRepository } from '../../engines/approval-engine/approval-history.repository';

const RFQ_REFERENCE_TYPE = 'rfq';
const RFQ_PENDING_STATUS = 'submitted' as const;

@Injectable()
export class RfqsService {
  constructor(
    private readonly rfqsRepo: RfqsRepository,
    private readonly approvalEngine: ApprovalEngine,
    private readonly approvalHistory: ApprovalHistoryRepository,
  ) {}

  async findAll(
    tenantId: string,
    status?: string,
    page?: string,
    perPage?: string,
  ) {
    return this.rfqsRepo.findAll(
      tenantId,
      status,
      new PaginationDto(page, perPage),
    );
  }

  async findById(id: string, tenantId: string) {
    const rfq: any = await this.rfqsRepo.findById(id, tenantId);
    if (!rfq) throw new NotFoundException('RFQ not found');
    return {
      ...rfq,
      branch_name: rfq.branches?.name ?? null,
      warehouse_name: rfq.warehouses?.name ?? null,
      items: (rfq.items ?? []).map((item: any) => ({
        ...item,
        item_name: item.items?.name ?? null,
      })),
      suppliers: (rfq.suppliers ?? []).map((s: any) => ({
        ...s,
        supplier_name: s.suppliers?.name ?? null,
      })),
    };
  }

  async create(tenantId: string, dto: CreateRfqDto, createdBy: string) {
    const { items, supplier_ids, ...header } = dto;
    return this.rfqsRepo.create(
      tenantId,
      {
        branch_id: header.branch_id ?? null,
        warehouse_id: header.warehouse_id ?? null,
        source_pr_id: header.source_pr_id ?? null,
        rfq_number: header.rfq_number,
        notes: header.notes ?? null,
      },
      items.map((line) => ({
        item_id: line.item_id,
        variant_id: line.variant_id ?? null,
        quantity_requested: line.quantity_requested,
        notes: line.notes ?? null,
      })),
      supplier_ids,
      createdBy,
    );
  }

  async update(id: string, tenantId: string, dto: UpdateRfqDto) {
    const rfq = await this.findById(id, tenantId);
    if (rfq.status !== 'draft') {
      throw new ForbiddenException('Only draft RFQs can be edited');
    }
    return this.rfqsRepo.update(id, tenantId, { ...dto });
  }

  async submit(id: string, tenantId: string, actorId: string) {
    const rfq = await this.findById(id, tenantId);
    const result = await this.rfqsRepo.submit(id, tenantId);
    await this.approvalHistory.record({
      tenantId,
      referenceType: RFQ_REFERENCE_TYPE,
      referenceId: id,
      action: 'submitted',
      actorId,
      previousStatus: rfq.status,
      newStatus: 'submitted',
    });
    return result;
  }

  async approve(id: string, tenantId: string, approvedBy: string) {
    const rfq = await this.findById(id, tenantId);
    if (!this.approvalEngine.canApprove(rfq.status, RFQ_PENDING_STATUS)) {
      throw new BadRequestException(
        `Cannot approve RFQ with status: ${rfq.status}`,
      );
    }
    const result = this.approvalEngine.approve(approvedBy);
    const updated = await this.rfqsRepo.approve(
      id,
      tenantId,
      result.resolvedBy,
      result.resolvedAt,
    );
    await this.approvalHistory.record({
      tenantId,
      referenceType: RFQ_REFERENCE_TYPE,
      referenceId: id,
      action: 'approved',
      actorId: approvedBy,
      previousStatus: rfq.status,
      newStatus: 'approved',
    });
    return updated;
  }

  async reject(
    id: string,
    tenantId: string,
    rejectedBy: string,
    dto: RejectRfqDto,
  ) {
    const rfq = await this.findById(id, tenantId);
    if (!this.approvalEngine.canReject(rfq.status, RFQ_PENDING_STATUS)) {
      throw new BadRequestException(
        `Cannot reject RFQ with status: ${rfq.status}`,
      );
    }
    const result = this.approvalEngine.reject(rejectedBy, dto.reason);
    const note = rfq.notes
      ? `${rfq.notes} | Rejected: ${result.reason}`
      : `Rejected: ${result.reason}`;
    const updated = await this.rfqsRepo.reject(
      id,
      tenantId,
      result.resolvedBy,
      result.resolvedAt,
      note,
    );
    await this.approvalHistory.record({
      tenantId,
      referenceType: RFQ_REFERENCE_TYPE,
      referenceId: id,
      action: 'rejected',
      actorId: rejectedBy,
      previousStatus: rfq.status,
      newStatus: 'rejected',
      reason: result.reason,
    });
    return updated;
  }

  async send(id: string, tenantId: string, actorId: string) {
    const rfq = await this.findById(id, tenantId);
    if (rfq.status !== 'approved') {
      throw new BadRequestException(
        `Cannot send RFQ with status: ${rfq.status} — it must be approved first`,
      );
    }
    const result = await this.rfqsRepo.markSent(id, tenantId);
    await this.approvalHistory.record({
      tenantId,
      referenceType: RFQ_REFERENCE_TYPE,
      referenceId: id,
      action: 'sent',
      actorId,
      previousStatus: 'approved',
      newStatus: 'sent',
    });
    return result;
  }

  async cancel(id: string, tenantId: string, actorId: string) {
    const rfq = await this.findById(id, tenantId);
    const result = await this.rfqsRepo.cancel(id, tenantId);
    await this.approvalHistory.record({
      tenantId,
      referenceType: RFQ_REFERENCE_TYPE,
      referenceId: id,
      action: 'cancelled',
      actorId,
      previousStatus: rfq.status,
      newStatus: 'cancelled',
    });
    return result;
  }

  async remove(id: string, tenantId: string) {
    const rfq = await this.findById(id, tenantId);
    if (rfq.status !== 'draft') {
      throw new ForbiddenException('Only draft RFQs can be deleted');
    }
    await this.rfqsRepo.softDelete(id, tenantId);
  }

  async history(id: string, tenantId: string) {
    await this.findById(id, tenantId);
    return this.approvalHistory.findForReference(
      tenantId,
      RFQ_REFERENCE_TYPE,
      id,
    );
  }
}
