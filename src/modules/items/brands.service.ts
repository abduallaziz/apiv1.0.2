import { Injectable, NotFoundException } from '@nestjs/common';
import { BrandsRepository } from './repositories/brands.repository';
import { CreateBrandDto } from './dto/create-brand.dto';
import { UpdateBrandDto } from './dto/update-brand.dto';

@Injectable()
export class BrandsService {
  constructor(private readonly brandsRepo: BrandsRepository) {}

  async findAll(tenantId: string) {
    return this.brandsRepo.findAll(tenantId);
  }

  async findById(id: string, tenantId: string) {
    const brand = await this.brandsRepo.findById(id, tenantId);
    if (!brand) throw new NotFoundException('Brand not found');
    return brand;
  }

  async create(tenantId: string, dto: CreateBrandDto) {
    return this.brandsRepo.create(tenantId, { ...dto });
  }

  async update(id: string, tenantId: string, dto: UpdateBrandDto) {
    await this.findById(id, tenantId);
    return this.brandsRepo.update(id, tenantId, { ...dto });
  }

  async remove(id: string, tenantId: string) {
    await this.findById(id, tenantId);
    // No FK from `items` to `brands` yet (deliberate — see migration 093 note),
    // so there's nothing to guard against being linked yet.
    await this.brandsRepo.softDelete(id, tenantId);
  }
}
