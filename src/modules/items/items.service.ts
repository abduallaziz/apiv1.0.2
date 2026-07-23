import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ItemsRepository } from './repositories/items.repository';
import { PaginationDto } from '../../shared/dto/pagination.dto';
import { RedisCacheService } from '../../core/cache/redis-cache.service';
import { CreateItemDto } from './dto/create-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { CreateVariantDto } from './dto/create-variant.dto';
import { UpdateVariantDto } from './dto/update-variant.dto';
import { ItemBarcodesService } from './item-barcodes.service';

const ITEMS_LIST_TTL = 300; // 5 minutes
const itemsListCacheKey = (tenantId: string, page: number, perPage: number) =>
  `items:list:tenant:${tenantId}:page:${page}:perPage:${perPage}`;

@Injectable()
export class ItemsService {
  private readonly logger = new Logger(ItemsService.name);

  constructor(
    private readonly itemsRepo: ItemsRepository,
    private readonly cache: RedisCacheService,
    private readonly barcodesService: ItemBarcodesService,
  ) {}

  async findAll(tenantId: string, page?: string, perPage?: string) {
    const pagination = new PaginationDto(page, perPage);
    const cacheKey = itemsListCacheKey(
      tenantId,
      pagination.page,
      pagination.perPage,
    );

    const cached =
      await this.cache.get<Awaited<ReturnType<ItemsRepository['findAll']>>>(
        cacheKey,
      );
    if (cached) return cached;

    const data = await this.itemsRepo.findAll(tenantId, pagination);
    await this.cache.set(cacheKey, data, ITEMS_LIST_TTL);
    return data;
  }

  async findById(id: string, tenantId: string) {
    const item = await this.itemsRepo.findById(id, tenantId);
    if (!item) throw new NotFoundException('Item not found');
    return item;
  }

  async create(tenantId: string, dto: CreateItemDto) {
    const item = await this.itemsRepo.create(tenantId, { ...dto });
    await this.invalidateList(tenantId);
    // Best-effort: a new item gets an auto-generated primary barcode
    // (create-item DTO has no barcode field, so this always applies) —
    // UNLESS it has_variants, in which case the parent item is never
    // sellable on its own (POS always routes has_variants items through
    // the variant picker, never adds the bare item to cart) and a
    // parent-level barcode would be dead weight with no real use. Each
    // variant gets its own barcode from createVariant() below instead.
    // A generation failure must never block item creation itself.
    if (!item.has_variants) {
      this.barcodesService
        .generateForItem(tenantId, item.id, null)
        .catch((err) => {
          this.logger.warn(
            `Auto barcode generation failed for item ${item.id}: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
    }
    return item;
  }

  async update(id: string, tenantId: string, dto: UpdateItemDto) {
    await this.findById(id, tenantId);
    const item = await this.itemsRepo.update(id, tenantId, { ...dto });
    await this.invalidateList(tenantId);
    return item;
  }

  async remove(id: string, tenantId: string) {
    await this.findById(id, tenantId);
    await this.itemsRepo.softDelete(id, tenantId);
    await this.invalidateList(tenantId);
  }

  private async invalidateList(tenantId: string): Promise<void> {
    await this.cache.delByPrefix(`items:list:tenant:${tenantId}:`);
  }

  // Variants
  async findVariants(itemId: string, tenantId: string) {
    await this.findById(itemId, tenantId); // verify item belongs to tenant
    return this.itemsRepo.findVariants(itemId, tenantId);
  }

  async createVariant(itemId: string, tenantId: string, dto: CreateVariantDto) {
    await this.findById(itemId, tenantId);
    const variant = await this.itemsRepo.createVariant(itemId, tenantId, {
      ...dto,
    });
    this.barcodesService
      .generateForItem(tenantId, itemId, variant.id)
      .catch((err) => {
        this.logger.warn(
          `Auto barcode generation failed for variant ${variant.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    return variant;
  }

  async updateVariant(
    variantId: string,
    itemId: string,
    tenantId: string,
    dto: UpdateVariantDto,
  ) {
    await this.findById(itemId, tenantId);
    return this.itemsRepo.updateVariant(variantId, itemId, tenantId, {
      ...dto,
    });
  }

  async removeVariant(variantId: string, itemId: string, tenantId: string) {
    await this.findById(itemId, tenantId);
    await this.itemsRepo.softDeleteVariant(variantId, itemId, tenantId);
  }
}
