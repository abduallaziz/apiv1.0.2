import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { NonConformancesRepository } from './repositories/non-conformances.repository';
import { InspectionsService } from './inspections.service';
import { ItemsService } from '../items/items.service';
import { CreateNonConformanceDto } from './dto/create-non-conformance.dto';
import { UpdateNonConformanceStatusDto } from './dto/update-non-conformance-status.dto';
import { CreateDefectDto } from './dto/create-defect.dto';
import { AuditService } from '../../core/audit/audit.service';

// open -> investigating -> containment -> corrective_action -> verification -> closed
const NC_LIFECYCLE = ['open', 'investigating', 'containment', 'corrective_action', 'verification', 'closed'];

@Injectable()
export class NonConformancesService {
  constructor(
    private readonly nonConformancesRepo: NonConformancesRepository,
    private readonly inspectionsService: InspectionsService,
    private readonly itemsService: ItemsService,
    private readonly auditService: AuditService,
  ) {}

  findAll(tenantId: string) {
    return this.nonConformancesRepo.findAll(tenantId);
  }

  async findById(id: string, tenantId: string) {
    const nc = await this.nonConformancesRepo.findById(id, tenantId);
    if (!nc) throw new NotFoundException('Non-conformance not found');
    return nc;
  }

  defects(id: string, tenantId: string) {
    return this.nonConformancesRepo.findDefects(tenantId, id);
  }

  // source='customer_complaint' -> Customer Complaints folded into NCR
  // (approved scope decision) — no quality_inspection_id required in that
  // case; every other source requires one (matches the schema's original
  // intent — an NCR should trace back to what found the problem).
  async create(tenantId: string, dto: CreateNonConformanceDto) {
    const source = dto.source ?? 'inspection';
    if (source !== 'customer_complaint' && !dto.quality_inspection_id) {
      throw new BadRequestException('quality_inspection_id is required unless source is customer_complaint');
    }
    if (dto.quality_inspection_id) {
      await this.inspectionsService.findById(dto.quality_inspection_id, tenantId);
    }
    await this.itemsService.findById(dto.item_id, tenantId);

    return this.nonConformancesRepo.create(tenantId, {
      quality_inspection_id: dto.quality_inspection_id ?? null,
      item_id: dto.item_id,
      description: dto.description,
      severity: dto.severity ?? 'minor',
      category: dto.category ?? null,
      source,
      customer_id: dto.customer_id ?? null,
      customer_reference: dto.customer_reference ?? null,
    });
  }

  async addDefect(id: string, tenantId: string, dto: CreateDefectDto) {
    await this.findById(id, tenantId);
    return this.nonConformancesRepo.addDefect(tenantId, id, {
      defect_code: dto.defect_code,
      category: dto.category,
      severity: dto.severity ?? 'minor',
      quantity_affected: dto.quantity_affected ?? null,
      cost_impact: dto.cost_impact ?? null,
    });
  }

  // Enforces the linear lifecycle strictly — no skipping stages, no
  // moving backward. 'closed' additionally requires resolved_by/resolved_at
  // (kept from the original schema) and is only reachable from
  // 'verification', ensuring a corrective action's effectiveness was
  // checked before a non-conformance can be closed.
  async updateStatus(id: string, tenantId: string, dto: UpdateNonConformanceStatusDto, actorId: string) {
    const existing: any = await this.findById(id, tenantId);
    const currentIdx = NC_LIFECYCLE.indexOf(existing.status);
    const targetIdx = NC_LIFECYCLE.indexOf(dto.status);
    if (targetIdx !== currentIdx + 1) {
      throw new BadRequestException(
        `Cannot move non-conformance from ${existing.status} to ${dto.status} — lifecycle must advance one stage at a time (${NC_LIFECYCLE.join(' -> ')})`,
      );
    }

    const payload: Record<string, unknown> = { status: dto.status };
    if (dto.root_cause) payload.root_cause = dto.root_cause;
    if (dto.resolution_notes) payload.resolution_notes = dto.resolution_notes;
    if (dto.status === 'closed') {
      payload.resolved_by = actorId;
      payload.resolved_at = new Date().toISOString();
    }

    const updated = await this.nonConformancesRepo.updateStatus(id, tenantId, existing.status, payload);
    if (!updated) {
      throw new BadRequestException(`Non-conformance ${id} status changed concurrently — retry`);
    }

    await this.nonConformancesRepo.recordStatusHistory(tenantId, id, existing.status, dto.status, actorId, dto.reason);

    if (dto.status === 'closed') {
      await this.auditService
        .log({
          tenant_id: tenantId,
          actor_id: actorId,
          action: 'non_conformance.closed',
          resource_type: 'non_conformance',
          resource_id: id,
          before_data: existing as unknown as Record<string, unknown>,
          after_data: updated as unknown as Record<string, unknown>,
        })
        .catch(() => {});
    }

    return updated;
  }
}
