import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DeviationsRepository } from './repositories/deviations.repository';
import { ItemsService } from '../items/items.service';
import { CreateDeviationDto } from './dto/create-deviation.dto';
import { DecideDeviationDto } from './dto/decide-deviation.dto';

@Injectable()
export class DeviationsService {
  constructor(
    private readonly deviationsRepo: DeviationsRepository,
    private readonly itemsService: ItemsService,
  ) {}

  findAll(tenantId: string) {
    return this.deviationsRepo.findAll(tenantId);
  }

  async findById(id: string, tenantId: string) {
    const deviation = await this.deviationsRepo.findById(id, tenantId);
    if (!deviation) throw new NotFoundException('Quality deviation not found');
    return deviation;
  }

  async create(tenantId: string, dto: CreateDeviationDto, requestedBy: string) {
    await this.itemsService.findById(dto.item_id, tenantId);
    return this.deviationsRepo.create(tenantId, {
      item_id: dto.item_id,
      non_conformance_id: dto.non_conformance_id ?? null,
      quality_inspection_id: dto.quality_inspection_id ?? null,
      reason: dto.reason,
      requested_by: requestedBy,
      expires_at: dto.expires_at ?? null,
    });
  }

  async decide(id: string, tenantId: string, dto: DecideDeviationDto, approverId: string) {
    const existing: any = await this.findById(id, tenantId);
    if (existing.status !== 'pending') {
      throw new BadRequestException(`Deviation ${id} is not pending (status=${existing.status})`);
    }
    const decided = await this.deviationsRepo.decide(id, tenantId, dto.approved ? 'approved' : 'rejected', approverId, dto.decision_notes);
    if (!decided) throw new BadRequestException(`Deviation ${id} status changed concurrently`);
    return decided;
  }
}
