import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AgreementsRepository } from './repositories/agreements.repository';
import { PaginationDto } from '../../shared/dto/pagination.dto';
import { CreateAgreementDto } from './dto/create-agreement.dto';
import { UpdateAgreementDto } from './dto/update-agreement.dto';
import { RejectAgreementDto } from './dto/reject-agreement.dto';
import { ApprovalEngine } from '../../engines/approval-engine/approval.engine';
import { ApprovalHistoryRepository } from '../../engines/approval-engine/approval-history.repository';

const AGREEMENT_REFERENCE_TYPE = 'agreement';
const AGREEMENT_PENDING_STATUS = 'submitted' as const;

@Injectable()
export class AgreementsService {
  constructor(
    private readonly agreementsRepo: AgreementsRepository,
    private readonly approvalEngine: ApprovalEngine,
    private readonly approvalHistory: ApprovalHistoryRepository,
  ) {}

  async findAll(
    tenantId: string,
    status?: string,
    page?: string,
    perPage?: string,
  ) {
    return this.agreementsRepo.findAll(
      tenantId,
      status,
      new PaginationDto(page, perPage),
    );
  }

  async findById(id: string, tenantId: string) {
    const agreement: any = await this.agreementsRepo.findById(id, tenantId);
    if (!agreement) throw new NotFoundException('Agreement not found');
    return {
      ...agreement,
      supplier_name: agreement.suppliers?.name ?? null,
      items: (agreement.items ?? []).map((item: any) => ({
        ...item,
        item_name: item.items?.name ?? null,
        item_sku: item.items?.sku ?? null,
      })),
    };
  }

  async create(tenantId: string, dto: CreateAgreementDto, createdBy: string) {
    const { items, ...header } = dto;
    return this.agreementsRepo.create(
      tenantId,
      {
        supplier_id: header.supplier_id,
        agreement_number: header.agreement_number,
        currency: header.currency ?? 'SAR',
        effective_date: header.effective_date ?? null,
        expiration_date: header.expiration_date ?? null,
        auto_expire: header.auto_expire ?? true,
        overage_policy: header.overage_policy ?? 'block',
        notes: header.notes ?? null,
      },
      items.map((line) => ({
        item_id: line.item_id,
        variant_id: line.variant_id ?? null,
        committed_quantity: line.committed_quantity ?? null,
        committed_value: line.committed_value ?? null,
        notes: line.notes ?? null,
      })),
      createdBy,
    );
  }

  async update(id: string, tenantId: string, dto: UpdateAgreementDto) {
    const agreement = await this.findById(id, tenantId);
    if (agreement.status !== 'draft') {
      throw new ForbiddenException('Only draft agreements can be edited');
    }
    return this.agreementsRepo.update(id, tenantId, { ...dto });
  }

  async submit(id: string, tenantId: string, actorId: string) {
    const agreement = await this.findById(id, tenantId);
    const result = await this.agreementsRepo.submit(id, tenantId);
    await this.approvalHistory.record({
      tenantId,
      referenceType: AGREEMENT_REFERENCE_TYPE,
      referenceId: id,
      action: 'submitted',
      actorId,
      previousStatus: agreement.status,
      newStatus: 'submitted',
    });
    return result;
  }

  async approve(id: string, tenantId: string, approvedBy: string) {
    const agreement = await this.findById(id, tenantId);
    if (
      !this.approvalEngine.canApprove(
        agreement.status,
        AGREEMENT_PENDING_STATUS,
      )
    ) {
      throw new BadRequestException(
        `Cannot approve agreement with status: ${agreement.status}`,
      );
    }
    const result = this.approvalEngine.approve(approvedBy);
    const updated = await this.agreementsRepo.approve(
      id,
      tenantId,
      result.resolvedBy,
      result.resolvedAt,
    );
    await this.approvalHistory.record({
      tenantId,
      referenceType: AGREEMENT_REFERENCE_TYPE,
      referenceId: id,
      action: 'approved',
      actorId: approvedBy,
      previousStatus: agreement.status,
      newStatus: 'approved',
    });
    return updated;
  }

  async reject(
    id: string,
    tenantId: string,
    rejectedBy: string,
    dto: RejectAgreementDto,
  ) {
    const agreement = await this.findById(id, tenantId);
    if (
      !this.approvalEngine.canReject(agreement.status, AGREEMENT_PENDING_STATUS)
    ) {
      throw new BadRequestException(
        `Cannot reject agreement with status: ${agreement.status}`,
      );
    }
    const result = this.approvalEngine.reject(rejectedBy, dto.reason);
    const note = agreement.notes
      ? `${agreement.notes} | Rejected: ${result.reason}`
      : `Rejected: ${result.reason}`;
    const updated = await this.agreementsRepo.reject(
      id,
      tenantId,
      result.resolvedBy,
      result.resolvedAt,
      note,
    );
    await this.approvalHistory.record({
      tenantId,
      referenceType: AGREEMENT_REFERENCE_TYPE,
      referenceId: id,
      action: 'rejected',
      actorId: rejectedBy,
      previousStatus: agreement.status,
      newStatus: 'rejected',
      reason: result.reason,
    });
    return updated;
  }

  async close(id: string, tenantId: string, actorId: string) {
    const agreement = await this.findById(id, tenantId);
    if (agreement.status !== 'approved') {
      throw new BadRequestException(
        `Cannot close agreement with status: ${agreement.status} — it must be approved first`,
      );
    }
    const result = await this.agreementsRepo.close(id, tenantId);
    await this.approvalHistory.record({
      tenantId,
      referenceType: AGREEMENT_REFERENCE_TYPE,
      referenceId: id,
      action: 'closed',
      actorId,
      previousStatus: 'approved',
      newStatus: 'closed',
    });
    return result;
  }

  async cancel(id: string, tenantId: string, actorId: string) {
    const agreement = await this.findById(id, tenantId);
    const result = await this.agreementsRepo.cancel(id, tenantId);
    await this.approvalHistory.record({
      tenantId,
      referenceType: AGREEMENT_REFERENCE_TYPE,
      referenceId: id,
      action: 'cancelled',
      actorId,
      previousStatus: agreement.status,
      newStatus: 'cancelled',
    });
    return result;
  }

  async remove(id: string, tenantId: string) {
    const agreement = await this.findById(id, tenantId);
    if (agreement.status !== 'draft') {
      throw new ForbiddenException('Only draft agreements can be deleted');
    }
    await this.agreementsRepo.softDelete(id, tenantId);
  }

  async history(id: string, tenantId: string) {
    await this.findById(id, tenantId);
    return this.approvalHistory.findForReference(
      tenantId,
      AGREEMENT_REFERENCE_TYPE,
      id,
    );
  }
}
