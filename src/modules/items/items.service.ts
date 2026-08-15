import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ItemsRepository } from './repositories/items.repository';
import { PaginationDto } from '../../shared/dto/pagination.dto';
import { RedisCacheService } from '../../core/cache/redis-cache.service';
import { CreateItemDto, CostingMethod } from './dto/create-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { CreateVariantDto } from './dto/create-variant.dto';
import { UpdateVariantDto } from './dto/update-variant.dto';
import { ItemBarcodesService } from './item-barcodes.service';
import { formatProductSku, formatVariantSku } from './utils/sku.util';
import { QueryItemsDto } from './dto/query-items.dto';
import { isUniqueViolation } from '../../shared/supabase/postgrest-error.util';

const MAX_SKU_GENERATE_ATTEMPTS = 5;

const ITEMS_LIST_TTL = 300; // 5 minutes
const itemsListCacheKey = (tenantId: string, query: QueryItemsDto) =>
  `items:list:tenant:${tenantId}:page:${query.page}:perPage:${query.per_page}:search:${query.search ?? ''}:type:${query.type ?? ''}:category:${query.category_id ?? ''}:active:${query.is_active}:sort:${query.sort}:dir:${query.dir}`;

@Injectable()
export class ItemsService {
  private readonly logger = new Logger(ItemsService.name);

  constructor(
    private readonly itemsRepo: ItemsRepository,
    private readonly cache: RedisCacheService,
    private readonly barcodesService: ItemBarcodesService,
  ) {}

  async findAll(tenantId: string, query: QueryItemsDto) {
    const pagination = new PaginationDto(query.page, query.per_page);
    const cacheKey = itemsListCacheKey(tenantId, query);

    const cached = await this.cache.get<{
      data: unknown[];
      total: number;
      page: number;
      perPage: number;
    }>(cacheKey);
    if (cached) return cached;

    const { data, total } = await this.itemsRepo.findAll(
      tenantId,
      pagination,
      query,
    );
    const envelope = {
      data,
      total,
      page: pagination.page,
      perPage: pagination.perPage,
    };
    await this.cache.set(cacheKey, envelope, ITEMS_LIST_TTL);
    return envelope;
  }

  async getStats(tenantId: string) {
    return this.itemsRepo.getStats(tenantId);
  }

  async findById(id: string, tenantId: string) {
    const item = await this.itemsRepo.findById(id, tenantId);
    if (!item) throw new NotFoundException('Item not found');
    // Only meaningful for a sellable-on-its-own item — one with variants is
    // never sold at the parent level, so its own stock_levels rows (if any
    // exist) would be misleading here; each variant carries its own figure
    // instead (see item_variants.stock_quantity in findById's select).
    if (!item.has_variants) {
      (item as { stock_quantity?: number }).stock_quantity =
        await this.itemsRepo.sumStockAcrossWarehouses(tenantId, id);
    }
    return item;
  }

  // Migration 13.15-fix — the costing engine itself (fn_add_cost_layer /
  // fn_consume_cost_layers) is untouched; this only prevents an item from
  // being saved in a state those functions would later reject at
  // consumption time (standard costing requires standard_cost to be set —
  // confirmed by reading fn_consume_cost_layers, migration 111).
  private assertStandardCostPresent(
    costingMethod: CostingMethod | string | undefined,
    standardCost: number | null | undefined,
  ): void {
    if (
      costingMethod === CostingMethod.STANDARD &&
      (standardCost === null || standardCost === undefined)
    ) {
      throw new BadRequestException(
        'standard_cost is required when costing_method is "standard"',
      );
    }
  }

  async create(tenantId: string, dto: CreateItemDto) {
    this.assertStandardCostPresent(dto.costing_method, dto.standard_cost);
    const { sku: manualSku, ...rest } = dto;

    if (manualSku) {
      const item = await this.itemsRepo.create(tenantId, {
        ...rest,
        sku: manualSku,
        sku_source: 'manual',
      });
      await this.invalidateList(tenantId);
      return this.attachAutoBarcode(tenantId, item);
    }

    // Auto path: the underlying sequence (fn_next_sku_seq) is atomic and
    // strictly increasing per tenant, so a collision on the generated value
    // itself is not expected — this retry only guards the theoretical case
    // where a manually-entered SKU elsewhere already happens to match a
    // not-yet-issued auto value, same defensive pattern as barcode
    // generation (item-barcodes.service.ts#generateForItem).
    for (let attempt = 0; attempt < MAX_SKU_GENERATE_ATTEMPTS; attempt++) {
      const seq = await this.itemsRepo.nextSkuSequence(tenantId);
      const sku = formatProductSku(seq);
      try {
        const item = await this.itemsRepo.create(tenantId, {
          ...rest,
          sku,
          sku_source: 'auto',
        });
        await this.invalidateList(tenantId);
        return this.attachAutoBarcode(tenantId, item);
      } catch (error) {
        if (isUniqueViolation(error)) continue;
        throw error;
      }
    }
    throw new Error(
      `Failed to generate a unique SKU for a new item (tenant ${tenantId}) after ${MAX_SKU_GENERATE_ATTEMPTS} attempts`,
    );
  }

  private attachAutoBarcode(
    tenantId: string,
    item: { id: string; has_variants: boolean },
  ) {
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
    const existing: any = await this.findById(id, tenantId);
    const effectiveCostingMethod =
      dto.costing_method ?? existing.costing_method;
    const effectiveStandardCost =
      dto.standard_cost !== undefined
        ? dto.standard_cost
        : existing.standard_cost;
    this.assertStandardCostPresent(
      effectiveCostingMethod,
      effectiveStandardCost,
    );
    // Presence of `sku` in the request body — not its value — is what marks
    // it manual: ItemFormModal only includes the field when the user
    // actually changed it, so a resubmit of the same value never silently
    // flips an 'auto' item back to 'manual'.
    const payload: Record<string, unknown> = { ...dto };
    if (dto.sku !== undefined) payload.sku_source = 'manual';
    const item = await this.itemsRepo.update(id, tenantId, payload);
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
    const parent = await this.findById(itemId, tenantId);
    const { sku: manualSku, ...rest } = dto;

    let variant: { id: string; [key: string]: unknown };
    if (manualSku) {
      variant = await this.itemsRepo.createVariant(itemId, tenantId, {
        ...rest,
        sku: manualSku,
        sku_source: 'manual',
      });
    } else if (!(parent as { sku?: string }).sku) {
      // Defensive only — every item now gets a SKU at creation time (auto or
      // manual), so this should not happen in practice. Falling back to no
      // SKU rather than throwing keeps variant creation from being blocked
      // by an inconsistency in unrelated, pre-existing data.
      variant = await this.itemsRepo.createVariant(itemId, tenantId, {
        ...rest,
      });
    } else {
      let created: { id: string; [key: string]: unknown } | null = null;
      for (let attempt = 0; attempt < MAX_SKU_GENERATE_ATTEMPTS; attempt++) {
        const seq = await this.itemsRepo.nextVariantSkuSequence(
          tenantId,
          itemId,
        );
        const sku = formatVariantSku((parent as { sku: string }).sku, seq);
        try {
          created = await this.itemsRepo.createVariant(itemId, tenantId, {
            ...rest,
            sku,
            sku_source: 'auto',
          });
          break;
        } catch (error) {
          if (isUniqueViolation(error)) continue;
          throw error;
        }
      }
      if (!created) {
        throw new Error(
          `Failed to generate a unique SKU for a new variant of item ${itemId} after ${MAX_SKU_GENERATE_ATTEMPTS} attempts`,
        );
      }
      variant = created;
    }

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
    const payload: Record<string, unknown> = { ...dto };
    if (dto.sku !== undefined) payload.sku_source = 'manual';
    return this.itemsRepo.updateVariant(variantId, itemId, tenantId, payload);
  }

  async removeVariant(variantId: string, itemId: string, tenantId: string) {
    await this.findById(itemId, tenantId);
    await this.itemsRepo.softDeleteVariant(variantId, itemId, tenantId);
  }
}
