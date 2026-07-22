import { Injectable, NotFoundException } from '@nestjs/common';
import { UnitsRepository } from './repositories/units.repository';
import { CreateUnitDto } from './dto/create-unit.dto';
import { UpdateUnitDto } from './dto/update-unit.dto';

@Injectable()
export class UnitsService {
  constructor(private readonly unitsRepo: UnitsRepository) {}

  async findAll(tenantId: string) {
    return this.unitsRepo.findAll(tenantId);
  }

  async findById(id: string, tenantId: string) {
    const unit = await this.unitsRepo.findById(id, tenantId);
    if (!unit) throw new NotFoundException('Unit not found');
    return unit;
  }

  async create(tenantId: string, dto: CreateUnitDto) {
    return this.unitsRepo.create(tenantId, { ...dto });
  }

  async update(id: string, tenantId: string, dto: UpdateUnitDto) {
    await this.findById(id, tenantId);
    return this.unitsRepo.update(id, tenantId, { ...dto });
  }

  async remove(id: string, tenantId: string) {
    await this.findById(id, tenantId);
    // No FK from `items` to `units` yet (deliberate — see migration 093 note),
    // so there's nothing to guard against being linked yet.
    await this.unitsRepo.softDelete(id, tenantId);
  }
}
