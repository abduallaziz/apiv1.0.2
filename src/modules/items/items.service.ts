import { Injectable, NotFoundException } from '@nestjs/common';
import { ItemsRepository } from './repositories/items.repository';
import { CreateItemDto } from './dto/create-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { CreateVariantDto } from './dto/create-variant.dto';
import { UpdateVariantDto } from './dto/update-variant.dto';

@Injectable()
export class ItemsService {
  constructor(private readonly itemsRepo: ItemsRepository) {}

  async findAll(tenantId: string) {
    return this.itemsRepo.findAll(tenantId);
  }

  async findById(id: string, tenantId: string) {
    const item = await this.itemsRepo.findById(id, tenantId);
    if (!item) throw new NotFoundException('Item not found');
    return item;
  }

  async create(tenantId: string, dto: CreateItemDto) {
    return this.itemsRepo.create(tenantId, { ...dto });
  }

  async update(id: string, tenantId: string, dto: UpdateItemDto) {
    await this.findById(id, tenantId);
    return this.itemsRepo.update(id, tenantId, { ...dto });
  }

  async remove(id: string, tenantId: string) {
    await this.findById(id, tenantId);
    await this.itemsRepo.softDelete(id, tenantId);
  }

  // Variants
  async findVariants(itemId: string, tenantId: string) {
    await this.findById(itemId, tenantId); // verify item belongs to tenant
    return this.itemsRepo.findVariants(itemId, tenantId);
  }

  async createVariant(itemId: string, tenantId: string, dto: CreateVariantDto) {
    await this.findById(itemId, tenantId);
    return this.itemsRepo.createVariant(itemId, tenantId, { ...dto });
  }

  async updateVariant(
    variantId: string,
    itemId: string,
    tenantId: string,
    dto: UpdateVariantDto,
  ) {
    await this.findById(itemId, tenantId);
    return this.itemsRepo.updateVariant(variantId, itemId, tenantId, { ...dto });
  }

  async removeVariant(variantId: string, itemId: string, tenantId: string) {
    await this.findById(itemId, tenantId);
    await this.itemsRepo.softDeleteVariant(variantId, itemId, tenantId);
  }
}