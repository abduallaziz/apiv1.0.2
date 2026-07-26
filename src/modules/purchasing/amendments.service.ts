import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AmendmentsRepository } from './repositories/amendments.repository';
import { PaginationDto } from '../../shared/dto/pagination.dto';
import {
  CreateAmendmentDto,
  AmendmentLineDto,
} from './dto/create-amendment.dto';
import { UpdateAmendmentDto } from './dto/update-amendment.dto';
import { RejectAmendmentDto } from './dto/reject-amendment.dto';
import { ApprovalEngine } from '../../engines/approval-engine/approval.engine';
import { ApprovalHistoryRepository } from '../../engines/approval-engine/approval-history.repository';

const AMENDMENT_REFERENCE_TYPE = 'agreement_amendment';
const AMENDMENT_PENDING_STATUS = 'submitted' as const;

// Commercial types renegotiate a live commercial relationship, so the
// agreement must already be approved. administrative_correction fixes
// the RECORD, not the relationship, so it is allowed regardless of the
// agreement's status -- the eligibility rule decided in 9.5.3, applied
// here for the first time.
const COMMERCIAL_AMENDMENT_TYPES = [
  'quantity_change',
  'value_change',
  'price_change',
  'extension',
  'general',
];

@Injectable()
export class AmendmentsService {
  constructor(
    private readonly amendmentsRepo: AmendmentsRepository,
    private readonly approvalEngine: ApprovalEngine,
    private readonly approvalHistory: ApprovalHistoryRepository,
  ) {}

  async findAll(
    tenantId: string,
    agreementId?: string,
    status?: string,
    page?: string,
    perPage?: string,
  ) {
    return this.amendmentsRepo.findAll(
      tenantId,
      agreementId,
      status,
      new PaginationDto(page, perPage),
    );
  }

  async findById(id: string, tenantId: string) {
    const amendment: any = await this.amendmentsRepo.findById(id, tenantId);
    if (!amendment) throw new NotFoundException('Amendment not found');
    return {
      ...amendment,
      items: (amendment.items ?? []).map((item: any) => ({
        ...item,
        item_name:
          item.action === 'add'
            ? (item.new_item?.name ?? null)
            : (item.agreement_items?.items?.name ?? null),
      })),
    };
  }

  async create(tenantId: string, dto: CreateAmendmentDto, createdBy: string) {
    const agreementStatus = await this.amendmentsRepo.getAgreementStatus(
      dto.agreement_id,
      tenantId,
    );
    if (!agreementStatus) {
      throw new BadRequestException('Agreement not found');
    }

    if (
      COMMERCIAL_AMENDMENT_TYPES.includes(dto.amendment_type) &&
      agreementStatus !== 'approved'
    ) {
      throw new BadRequestException(
        `Cannot create a '${dto.amendment_type}' amendment: the agreement must be approved (current status: ${agreementStatus}). Only 'administrative_correction' is allowed regardless of agreement status.`,
      );
    }

    const items = [];
    for (const line of dto.items) {
      if (line.action === 'add') {
        const hasVariants = await this.amendmentsRepo.getItemHasVariants(
          line.item_id,
          tenantId,
        );
        if (hasVariants && !line.variant_id) {
          throw new BadRequestException(
            `Item ${line.item_id} requires a variant to be specified`,
          );
        }
        items.push(this.mapAddLine(line));
      } else {
        items.push(this.mapModifyOrDiscontinueLine(line));
      }
    }

    return this.amendmentsRepo.create(
      tenantId,
      {
        agreement_id: dto.agreement_id,
        amendment_number: dto.amendment_number,
        amendment_type: dto.amendment_type,
        new_expiration_date: dto.new_expiration_date ?? null,
        notes: dto.notes ?? null,
      },
      items,
      createdBy,
    );
  }

  private mapAddLine(line: AmendmentLineDto) {
    return {
      action: 'add',
      agreement_item_id: null,
      new_item_id: line.item_id,
      new_variant_id: line.variant_id ?? null,
      delta_committed_quantity: line.delta_committed_quantity ?? null,
      delta_committed_value: line.delta_committed_value ?? null,
      notes: line.notes ?? null,
    };
  }

  private mapModifyOrDiscontinueLine(line: AmendmentLineDto) {
    return {
      action: line.action,
      agreement_item_id: line.agreement_item_id,
      new_item_id: null,
      new_variant_id: null,
      delta_committed_quantity:
        line.action === 'modify'
          ? (line.delta_committed_quantity ?? null)
          : null,
      delta_committed_value:
        line.action === 'modify' ? (line.delta_committed_value ?? null) : null,
      new_unit_price:
        line.action === 'modify' ? (line.new_unit_price ?? null) : null,
      new_discount_percent:
        line.action === 'modify' ? (line.new_discount_percent ?? null) : null,
      notes: line.notes ?? null,
    };
  }

  async update(id: string, tenantId: string, dto: UpdateAmendmentDto) {
    const amendment = await this.findById(id, tenantId);
    if (amendment.status !== 'draft') {
      throw new ForbiddenException('Only draft amendments can be edited');
    }
    return this.amendmentsRepo.update(id, tenantId, { ...dto });
  }

  async submit(id: string, tenantId: string, actorId: string) {
    const amendment = await this.findById(id, tenantId);
    const result = await this.amendmentsRepo.submit(id, tenantId);
    await this.approvalHistory.record({
      tenantId,
      referenceType: AMENDMENT_REFERENCE_TYPE,
      referenceId: id,
      action: 'submitted',
      actorId,
      previousStatus: amendment.status,
      newStatus: 'submitted',
    });
    return result;
  }

  async approve(id: string, tenantId: string, approvedBy: string) {
    const amendment = await this.findById(id, tenantId);
    if (
      !this.approvalEngine.canApprove(
        amendment.status,
        AMENDMENT_PENDING_STATUS,
      )
    ) {
      throw new BadRequestException(
        `Cannot approve amendment with status: ${amendment.status}`,
      );
    }
    const result = this.approvalEngine.approve(approvedBy);
    // fn_approve_agreement_amendment (137) applies the delta to
    // agreement_items, flips the status, AND records approval_history
    // itself inside one atomic transaction -- do NOT call
    // approvalHistory.record() again here, that would double-record.
    return this.amendmentsRepo.approve(
      id,
      tenantId,
      result.resolvedBy,
      result.resolvedAt,
    );
  }

  async reject(
    id: string,
    tenantId: string,
    rejectedBy: string,
    dto: RejectAmendmentDto,
  ) {
    const amendment = await this.findById(id, tenantId);
    if (
      !this.approvalEngine.canReject(amendment.status, AMENDMENT_PENDING_STATUS)
    ) {
      throw new BadRequestException(
        `Cannot reject amendment with status: ${amendment.status}`,
      );
    }
    const result = this.approvalEngine.reject(rejectedBy, dto.reason);
    const note = amendment.notes
      ? `${amendment.notes} | Rejected: ${result.reason}`
      : `Rejected: ${result.reason}`;
    const updated = await this.amendmentsRepo.reject(
      id,
      tenantId,
      result.resolvedBy,
      result.resolvedAt,
      note,
    );
    await this.approvalHistory.record({
      tenantId,
      referenceType: AMENDMENT_REFERENCE_TYPE,
      referenceId: id,
      action: 'rejected',
      actorId: rejectedBy,
      previousStatus: amendment.status,
      newStatus: 'rejected',
      reason: result.reason,
    });
    return updated;
  }

  async cancel(id: string, tenantId: string, actorId: string) {
    const amendment = await this.findById(id, tenantId);
    if (amendment.status === 'approved') {
      throw new BadRequestException(
        'Cannot cancel an approved amendment -- it is a terminal state. Correct it with a new administrative_correction amendment instead.',
      );
    }
    const result = await this.amendmentsRepo.cancel(id, tenantId);
    await this.approvalHistory.record({
      tenantId,
      referenceType: AMENDMENT_REFERENCE_TYPE,
      referenceId: id,
      action: 'cancelled',
      actorId,
      previousStatus: amendment.status,
      newStatus: 'cancelled',
    });
    return result;
  }

  async remove(id: string, tenantId: string) {
    const amendment = await this.findById(id, tenantId);
    if (amendment.status !== 'draft') {
      throw new ForbiddenException('Only draft amendments can be deleted');
    }
    await this.amendmentsRepo.softDelete(id, tenantId);
  }

  async history(id: string, tenantId: string) {
    await this.findById(id, tenantId);
    return this.approvalHistory.findForReference(
      tenantId,
      AMENDMENT_REFERENCE_TYPE,
      id,
    );
  }
}
