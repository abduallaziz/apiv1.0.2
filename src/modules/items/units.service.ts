import { Injectable, NotFoundException } from '@nestjs/common';
import { UnitsRepository } from './repositories/units.repository';
import { CreateUnitDto } from './dto/create-unit.dto';
import { UpdateUnitDto } from './dto/update-unit.dto';

@Injectable()
export class UnitsService {
  constructor(private readonly unitsRepo: UnitsRepository) {}

  async findAll(tenantId: string, branchId?: string | null) {
    return this.unitsRepo.findAll(tenantId, branchId);
  }

  async findById(id: string, tenantId: string, branchId?: string | null) {
    const unit = await this.unitsRepo.findById(id, tenantId, branchId);
    if (!unit) throw new NotFoundException('Unit not found');
    return unit;
  }

  async create(tenantId: string, dto: CreateUnitDto, branchId?: string | null) {
    return this.unitsRepo.create(tenantId, { ...dto }, branchId);
  }

  async update(
    id: string,
    tenantId: string,
    dto: UpdateUnitDto,
    branchId?: string | null,
  ) {
    await this.findById(id, tenantId, branchId);
    return this.unitsRepo.update(id, tenantId, { ...dto });
  }

  async remove(id: string, tenantId: string, branchId?: string | null) {
    await this.findById(id, tenantId, branchId);
    // No FK from `items` to `units` yet (deliberate — see migration 093 note),
    // so there's nothing to guard against being linked yet.
    await this.unitsRepo.softDelete(id, tenantId);
  }
}
