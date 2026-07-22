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

  async findAll(tenantId: string, type?: string) {
    return this.categoriesRepo.findAll(tenantId, type);
  }

  async findById(id: string, tenantId: string) {
    const category = await this.categoriesRepo.findById(id, tenantId);
    if (!category) throw new NotFoundException('Category not found');
    return category;
  }

  async create(tenantId: string, dto: CreateCategoryDto) {
    return this.categoriesRepo.create(tenantId, { ...dto });
  }

  async update(id: string, tenantId: string, dto: UpdateCategoryDto) {
    await this.findById(id, tenantId);
    return this.categoriesRepo.update(id, tenantId, { ...dto });
  }

  async remove(id: string, tenantId: string) {
    await this.findById(id, tenantId);
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
