import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ReleasesRepository } from './repositories/releases.repository';
import { AgreementsRepository } from './repositories/agreements.repository';
import { PaginationDto } from '../../shared/dto/pagination.dto';
import { CreateReleaseDto, ReleaseLineDto } from './dto/create-release.dto';
import { UpdateReleaseDto } from './dto/update-release.dto';
import { RejectReleaseDto } from './dto/reject-release.dto';
import { ApprovalEngine } from '../../engines/approval-engine/approval.engine';
import { ApprovalHistoryRepository } from '../../engines/approval-engine/approval-history.repository';
import { DiscountEngine } from '../../engines/discount-engine/discount.engine';

const RELEASE_REFERENCE_TYPE = 'agreement_release';
const RELEASE_PENDING_STATUS = 'submitted' as const;

@Injectable()
export class ReleasesService {
  constructor(
    private readonly releasesRepo: ReleasesRepository,
    // Reused, not duplicated: agreement eligibility (status/overage_policy)
    // is read via the existing AgreementsRepository.findById().
    private readonly agreementsRepo: AgreementsRepository,
    private readonly approvalEngine: ApprovalEngine,
    private readonly approvalHistory: ApprovalHistoryRepository,
    private readonly discountEngine: DiscountEngine,
  ) {}

  async findAll(
    tenantId: string,
    agreementId?: string,
    status?: string,
    page?: string,
    perPage?: string,
  ) {
    return this.releasesRepo.findAll(
      tenantId,
      agreementId,
      status,
      new PaginationDto(page, perPage),
    );
  }

  async findById(id: string, tenantId: string) {
    const release: any = await this.releasesRepo.findById(id, tenantId);
    if (!release) throw new NotFoundException('Release not found');
    return {
      ...release,
      items: (release.items ?? []).map((item: any) => ({
        ...item,
        item_name: item.agreement_items?.items?.name ?? null,
      })),
    };
  }

  async create(tenantId: string, dto: CreateReleaseDto, createdBy: string) {
    const agreement: any = await this.agreementsRepo.findById(
      dto.agreement_id,
      tenantId,
    );
    if (!agreement) throw new BadRequestException('Agreement not found');
    if (agreement.status !== 'approved') {
      throw new BadRequestException(
        `Cannot create a release for agreement with status: ${agreement.status}`,
      );
    }

    const items = [];
    for (const line of dto.items) {
      await this.validateOverage(line, agreement, tenantId);
      items.push(
        await this.buildSnapshotLine(line, tenantId, agreement.currency),
      );
    }

    const effectiveAmendmentId =
      await this.releasesRepo.getLatestApprovedAmendment(
        dto.agreement_id,
        tenantId,
      );

    return this.releasesRepo.create(
      tenantId,
      {
        agreement_id: dto.agreement_id,
        release_number: dto.release_number,
        notes: dto.notes ?? null,
        effective_amendment_id: effectiveAmendmentId,
      },
      items,
      createdBy,
    );
  }

  // overage_policy='block' only (per explicit decision) -- warn/
  // require_approval/allow are documented future enhancements, not
  // implemented (their workflow is undefined). Open Blanket items
  // (committed_quantity IS NULL) skip the check entirely -- no ceiling
  // exists to violate.
  private async validateOverage(
    line: ReleaseLineDto,
    agreement: any,
    tenantId: string,
  ) {
    const agreementItem = await this.releasesRepo.getAgreementItemCommitted(
      line.agreement_item_id,
      tenantId,
    );
    if (!agreementItem || agreementItem.agreement_id !== agreement.id) {
      throw new BadRequestException(
        `agreement_item ${line.agreement_item_id} does not belong to agreement ${agreement.id}`,
      );
    }
    if (agreementItem.committed_quantity === null) return; // Open Blanket

    if (agreement.overage_policy !== 'block') return; // future enhancement

    const alreadyReleased = await this.releasesRepo.getApprovedReleasedQuantity(
      line.agreement_item_id,
      tenantId,
    );
    const remaining =
      Number(agreementItem.committed_quantity) - alreadyReleased;
    if (line.released_quantity > remaining) {
      throw new BadRequestException(
        `Release quantity ${line.released_quantity} exceeds remaining committed quantity ${remaining} for agreement_item ${line.agreement_item_id} (overage_policy=block)`,
      );
    }
  }

  // Server-side pricing snapshot -- the client never submits a price.
  // Reuses DiscountEngine.applyPercentageDiscount (percent-based, matches
  // agreement_pricing's NUMERIC(5,2) percentage columns) for both the
  // discount and tax steps -- no second pricing formula introduced.
  private async buildSnapshotLine(
    line: ReleaseLineDto,
    tenantId: string,
    agreementCurrency: string,
  ) {
    const effective = await this.releasesRepo.getEffectivePricing(
      line.agreement_item_id,
      tenantId,
    );
    if (!effective) {
      throw new BadRequestException(
        `No pricing configured for agreement_item ${line.agreement_item_id}`,
      );
    }
    const { pricing, tiers } = effective;

    let unitPrice: number;
    let discountPercent: number;
    let sourcePricingTierId: string | null = null;

    if (pricing.pricing_type === 'tiered') {
      const tier = tiers.find(
        (t: any) =>
          line.released_quantity >= Number(t.min_quantity) &&
          (t.max_quantity === null ||
            line.released_quantity <= Number(t.max_quantity)),
      );
      if (!tier) {
        throw new BadRequestException(
          `No pricing tier matches quantity ${line.released_quantity} for agreement_item ${line.agreement_item_id}`,
        );
      }
      unitPrice = Number(tier.unit_price);
      discountPercent = Number(tier.discount_percent ?? 0);
      sourcePricingTierId = tier.id;
    } else if (pricing.pricing_type === 'rule_based') {
      throw new BadRequestException(
        'rule_based pricing is not yet supported for release creation',
      );
    } else {
      unitPrice = Number(pricing.unit_price);
      discountPercent = Number(pricing.discount_percent ?? 0);
    }

    const subtotal = line.released_quantity * unitPrice;
    const discountAmount = this.discountEngine.applyPercentageDiscount(
      subtotal,
      discountPercent,
    );
    const netAfterDiscount = subtotal - discountAmount;
    const taxRate = pricing.tax_rate !== null ? Number(pricing.tax_rate) : null;
    const taxAmount =
      taxRate !== null
        ? this.discountEngine.applyPercentageDiscount(netAfterDiscount, taxRate)
        : 0;
    const releasedAmount = parseFloat(
      (netAfterDiscount + taxAmount).toFixed(2),
    );

    return {
      agreement_item_id: line.agreement_item_id,
      released_quantity: line.released_quantity,
      snapshot_unit_price: unitPrice,
      snapshot_discount_percent: discountPercent,
      // agreement_pricing has no currency column -- currency is agreement
      // identity (single currency per agreement, per 9.5.1), not a
      // per-item negotiable term.
      snapshot_currency: agreementCurrency,
      snapshot_tax_rate: taxRate,
      released_amount: releasedAmount,
      source_pricing_tier_id: sourcePricingTierId,
      notes: line.notes ?? null,
    };
  }

  async update(id: string, tenantId: string, dto: UpdateReleaseDto) {
    const release = await this.findById(id, tenantId);
    if (release.status !== 'draft') {
      throw new ForbiddenException('Only draft releases can be edited');
    }
    return this.releasesRepo.update(id, tenantId, { ...dto });
  }

  async submit(id: string, tenantId: string, actorId: string) {
    const release = await this.findById(id, tenantId);
    const result = await this.releasesRepo.submit(id, tenantId);
    await this.approvalHistory.record({
      tenantId,
      referenceType: RELEASE_REFERENCE_TYPE,
      referenceId: id,
      action: 'submitted',
      actorId,
      previousStatus: release.status,
      newStatus: 'submitted',
    });
    return result;
  }

  async approve(id: string, tenantId: string, approvedBy: string) {
    const release = await this.findById(id, tenantId);
    if (
      !this.approvalEngine.canApprove(release.status, RELEASE_PENDING_STATUS)
    ) {
      throw new BadRequestException(
        `Cannot approve release with status: ${release.status}`,
      );
    }
    const result = this.approvalEngine.approve(approvedBy);
    const updated = await this.releasesRepo.approve(
      id,
      tenantId,
      result.resolvedBy,
      result.resolvedAt,
    );
    await this.approvalHistory.record({
      tenantId,
      referenceType: RELEASE_REFERENCE_TYPE,
      referenceId: id,
      action: 'approved',
      actorId: approvedBy,
      previousStatus: release.status,
      newStatus: 'approved',
    });
    return updated;
  }

  async reject(
    id: string,
    tenantId: string,
    rejectedBy: string,
    dto: RejectReleaseDto,
  ) {
    const release = await this.findById(id, tenantId);
    if (
      !this.approvalEngine.canReject(release.status, RELEASE_PENDING_STATUS)
    ) {
      throw new BadRequestException(
        `Cannot reject release with status: ${release.status}`,
      );
    }
    const result = this.approvalEngine.reject(rejectedBy, dto.reason);
    const note = release.notes
      ? `${release.notes} | Rejected: ${result.reason}`
      : `Rejected: ${result.reason}`;
    const updated = await this.releasesRepo.reject(
      id,
      tenantId,
      result.resolvedBy,
      result.resolvedAt,
      note,
    );
    await this.approvalHistory.record({
      tenantId,
      referenceType: RELEASE_REFERENCE_TYPE,
      referenceId: id,
      action: 'rejected',
      actorId: rejectedBy,
      previousStatus: release.status,
      newStatus: 'rejected',
      reason: result.reason,
    });
    return updated;
  }

  async cancel(id: string, tenantId: string, actorId: string) {
    const release = await this.findById(id, tenantId);
    if (release.status === 'approved') {
      throw new BadRequestException(
        'Cannot cancel an approved release -- it is a terminal state.',
      );
    }
    const result = await this.releasesRepo.cancel(id, tenantId);
    await this.approvalHistory.record({
      tenantId,
      referenceType: RELEASE_REFERENCE_TYPE,
      referenceId: id,
      action: 'cancelled',
      actorId,
      previousStatus: release.status,
      newStatus: 'cancelled',
    });
    return result;
  }

  async remove(id: string, tenantId: string) {
    const release = await this.findById(id, tenantId);
    if (release.status !== 'draft') {
      throw new ForbiddenException('Only draft releases can be deleted');
    }
    await this.releasesRepo.softDelete(id, tenantId);
  }

  async history(id: string, tenantId: string) {
    await this.findById(id, tenantId);
    return this.approvalHistory.findForReference(
      tenantId,
      RELEASE_REFERENCE_TYPE,
      id,
    );
  }
}
