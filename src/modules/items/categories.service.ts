import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CategoriesRepository } from './repositories/categories.repository';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Injectable()
export class CategoriesService {
  constructor(private readonly categoriesRepo: CategoriesRepository) {}

  async findAll(tenantId: string, type?: string, branchId?: string | null) {
    return this.categoriesRepo.findAll(tenantId, type, branchId);
  }

  async findById(id: string, tenantId: string, branchId?: string | null) {
    const category = await this.categoriesRepo.findById(id, tenantId, branchId);
    if (!category) throw new NotFoundException('Category not found');
    return category;
  }

  async create(
    tenantId: string,
    dto: CreateCategoryDto,
    branchId?: string | null,
  ) {
    return this.categoriesRepo.create(tenantId, { ...dto }, branchId);
  }

  async update(
    id: string,
    tenantId: string,
    dto: UpdateCategoryDto,
    branchId?: string | null,
  ) {
    await this.findById(id, tenantId, branchId);
    return this.categoriesRepo.update(id, tenantId, { ...dto });
  }

  async remove(id: string, tenantId: string, branchId?: string | null) {
    await this.findById(id, tenantId, branchId);
    const hasLinkedItems = await this.categoriesRepo.hasLinkedItems(
      id,
      tenantId,
    );
    if (hasLinkedItems) {
      throw new ConflictException(
        'Cannot delete a category with linked items — deactivate it instead',
      );
    }
    await this.categoriesRepo.softDelete(id, tenantId);
  }
}
