import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { NonConformancesRepository } from './repositories/non-conformances.repository';
import { InspectionsService } from './inspections.service';
import { ItemsService } from '../items/items.service';
import { CreateNonConformanceDto } from './dto/create-non-conformance.dto';
import { AuditService } from '../../core/audit/audit.service';

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

  async create(tenantId: string, dto: CreateNonConformanceDto) {
    await this.inspectionsService.findById(dto.quality_inspection_id, tenantId); // throws NotFoundException if missing
    await this.itemsService.findById(dto.item_id, tenantId); // throws NotFoundException if missing

    return this.nonConformancesRepo.create(tenantId, {
      quality_inspection_id: dto.quality_inspection_id,
      item_id: dto.item_id,
      description: dto.description,
      severity: dto.severity ?? 'minor',
    });
  }

  async close(id: string, tenantId: string, resolvedBy: string) {
    const existing = await this.findById(id, tenantId);
    if ((existing as any).status !== 'open') {
      throw new BadRequestException(`Non-conformance ${id} is not open (status=${(existing as any).status})`);
    }
    const closed = await this.nonConformancesRepo.close(id, tenantId, resolvedBy);
    if (!closed) {
      throw new BadRequestException(`Non-conformance ${id} is not open`);
    }
    // Manual audit call (no @Audit() decorator on this route) — captures
    // before_data (the open non-conformance), which the interceptor alone
    // never does; resolvedBy is already available here as the actor.
    await this.auditService
      .log({
        tenant_id: tenantId,
        actor_id: resolvedBy,
        action: 'non_conformance.closed',
        resource_type: 'non_conformance',
        resource_id: id,
        before_data: existing as unknown as Record<string, unknown>,
        after_data: closed as unknown as Record<string, unknown>,
      })
      .catch(() => {});
    return closed;
  }
}
