import { Injectable, NotFoundException } from '@nestjs/common';
import { ReorderPointsRepository } from './repositories/reorder-points.repository';
import { CreateReorderPointDto } from './dto/create-reorder-point.dto';
import { UpdateReorderPointDto } from './dto/update-reorder-point.dto';

@Injectable()
export class ReorderPointsService {
  constructor(private readonly reorderPointsRepo: ReorderPointsRepository) {}

  findAll(tenantId: string, warehouseId?: string) {
    return this.reorderPointsRepo.findAll(tenantId, warehouseId);
  }

  async findById(id: string, tenantId: string) {
    const point = await this.reorderPointsRepo.findById(id, tenantId);
    if (!point) throw new NotFoundException('Reorder point not found');
    return point;
  }

  create(tenantId: string, dto: CreateReorderPointDto) {
    return this.reorderPointsRepo.upsert(tenantId, { ...dto, is_active: true });
  }

  async update(id: string, tenantId: string, dto: UpdateReorderPointDto) {
    await this.findById(id, tenantId);
    return this.reorderPointsRepo.update(id, tenantId, { ...dto });
  }

  async remove(id: string, tenantId: string) {
    await this.findById(id, tenantId);
    await this.reorderPointsRepo.remove(id, tenantId);
  }

  belowMinimum(tenantId: string) {
    return this.reorderPointsRepo.findBelowMinimum(tenantId);
  }
}
