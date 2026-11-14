import { Injectable, NotFoundException } from '@nestjs/common';
import { BrandsRepository } from './repositories/brands.repository';
import { CreateBrandDto } from './dto/create-brand.dto';
import { UpdateBrandDto } from './dto/update-brand.dto';

@Injectable()
export class BrandsService {
  constructor(private readonly brandsRepo: BrandsRepository) {}

  async findAll(tenantId: string, branchId?: string | null) {
    return this.brandsRepo.findAll(tenantId, branchId);
  }

  async findById(id: string, tenantId: string, branchId?: string | null) {
    const brand = await this.brandsRepo.findById(id, tenantId, branchId);
    if (!brand) throw new NotFoundException('Brand not found');
    return brand;
  }

  async create(
    tenantId: string,
    dto: CreateBrandDto,
    branchId?: string | null,
  ) {
    return this.brandsRepo.create(tenantId, { ...dto }, branchId);
  }

  async update(
    id: string,
    tenantId: string,
    dto: UpdateBrandDto,
    branchId?: string | null,
  ) {
    await this.findById(id, tenantId, branchId);
    return this.brandsRepo.update(id, tenantId, { ...dto });
  }

  async remove(id: string, tenantId: string, branchId?: string | null) {
    await this.findById(id, tenantId, branchId);
    // No FK from `items` to `brands` yet (deliberate — see migration 093 note),
    // so there's nothing to guard against being linked yet.
    await this.brandsRepo.softDelete(id, tenantId);
  }
}
