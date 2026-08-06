import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InspectionsRepository } from './repositories/inspections.repository';
import { ItemsService } from '../items/items.service';
import { CreateInspectionDto } from './dto/create-inspection.dto';
import { CompleteInspectionDto } from './dto/complete-inspection.dto';

@Injectable()
export class InspectionsService {
  constructor(
    private readonly inspectionsRepo: InspectionsRepository,
    private readonly itemsService: ItemsService,
  ) {}

  findAll(tenantId: string) {
    return this.inspectionsRepo.findAll(tenantId);
  }

  async findById(id: string, tenantId: string) {
    const inspection = await this.inspectionsRepo.findById(id, tenantId);
    if (!inspection) throw new NotFoundException('Quality inspection not found');
    return inspection;
  }

  async create(tenantId: string, dto: CreateInspectionDto, createdBy: string) {
    await this.itemsService.findById(dto.item_id, tenantId); // throws NotFoundException if missing
    return this.inspectionsRepo.create(tenantId, {
      reference_type: dto.reference_type,
      reference_id: dto.reference_id,
      item_id: dto.item_id,
      variant_id: dto.variant_id ?? null,
      notes: dto.notes ?? null,
      created_by: createdBy,
    });
  }

  async complete(id: string, tenantId: string, dto: CompleteInspectionDto) {
    const existing = await this.findById(id, tenantId);
    if ((existing as any).status !== 'pending') {
      throw new BadRequestException(
        `Inspection ${id} is not pending (status=${(existing as any).status})`,
      );
    }
    const completed = await this.inspectionsRepo.complete(id, tenantId, {
      status: dto.status,
      notes: dto.notes,
    });
    if (!completed) {
      throw new BadRequestException(`Inspection ${id} is not pending`);
    }
    return completed;
  }
}
