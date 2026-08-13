import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InspectionsRepository } from './repositories/inspections.repository';
import { HoldsRepository } from './repositories/holds.repository';
import { ItemsService } from '../items/items.service';
import { CreateInspectionDto } from './dto/create-inspection.dto';
import { CompleteInspectionDto } from './dto/complete-inspection.dto';

@Injectable()
export class InspectionsService {
  constructor(
    private readonly inspectionsRepo: InspectionsRepository,
    private readonly holdsRepo: HoldsRepository,
    private readonly itemsService: ItemsService,
  ) {}

  findAll(tenantId: string) {
    return this.inspectionsRepo.findAll(tenantId);
  }

  async findById(id: string, tenantId: string) {
    const inspection = await this.inspectionsRepo.findById(id, tenantId);
    if (!inspection)
      throw new NotFoundException('Quality inspection not found');
    return inspection;
  }

  results(id: string, tenantId: string) {
    return this.inspectionsRepo.getResults(tenantId, id);
  }

  async create(tenantId: string, dto: CreateInspectionDto, createdBy: string) {
    await this.itemsService.findById(dto.item_id, tenantId); // throws NotFoundException if missing
    return this.inspectionsRepo.create(tenantId, {
      reference_type: dto.reference_type,
      reference_id: dto.reference_id,
      item_id: dto.item_id,
      variant_id: dto.variant_id ?? null,
      template_id: dto.template_id ?? null,
      plan_id: dto.plan_id ?? null,
      warehouse_id: dto.warehouse_id ?? null,
      batch_id: dto.batch_id ?? null,
      quantity_inspected: dto.quantity_inspected ?? null,
      is_sampling: dto.is_sampling ?? false,
      sample_size: dto.sample_size ?? null,
      notes: dto.notes ?? null,
      created_by: createdBy,
    });
  }

  // pending -> passed/failed/conditional. When status='failed' and
  // auto_hold is requested, a quality_hold is created in the same
  // operation via fn_create_quality_hold (hard block applied
  // immediately) — "Failed Inspection -> Quality Hold" from the approved
  // design. Requires warehouse_id to have been set on the inspection
  // (via create() or defaulted by the caller's integration point).
  async complete(
    id: string,
    tenantId: string,
    dto: CompleteInspectionDto,
    actorId: string,
  ) {
    const existing: any = await this.findById(id, tenantId);
    if (existing.status !== 'pending') {
      throw new BadRequestException(
        `Inspection ${id} is not pending (status=${existing.status})`,
      );
    }

    const completed = await this.inspectionsRepo.complete(id, tenantId, {
      status: dto.status,
      notes: dto.notes,
      defect_count: dto.defect_count ?? null,
    });
    if (!completed) {
      throw new BadRequestException(`Inspection ${id} is not pending`);
    }

    if (dto.results?.length) {
      await this.inspectionsRepo.addResults(
        tenantId,
        id,
        dto.results as unknown as Record<string, unknown>[],
      );
    }

    let hold = null;
    if (dto.status === 'failed' && dto.auto_hold) {
      if (!existing.warehouse_id) {
        throw new BadRequestException(
          'Cannot auto-create a hold: this inspection has no warehouse_id — pass one on create, or create the hold manually',
        );
      }
      hold = await this.holdsRepo.create(tenantId, {
        warehouse_id: existing.warehouse_id,
        item_id: existing.item_id,
        variant_id: existing.variant_id ?? null,
        location_id: null,
        batch_id: existing.batch_id ?? null,
        serial_id: null,
        quantity_held: existing.quantity_inspected ?? null,
        reason: `Auto-created: failed inspection ${id}`,
        source_document_type: existing.reference_type,
        source_document_id: existing.reference_id,
        quality_inspection_id: id,
        created_by: actorId,
      });
    }

    return { ...completed, auto_created_hold: hold };
  }
}
