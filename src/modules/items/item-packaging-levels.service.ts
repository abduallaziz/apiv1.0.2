import {
  ConflictException,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ItemPackagingLevelsRepository } from './repositories/item-packaging-levels.repository';
import { ItemsRepository } from './repositories/items.repository';
import { CreatePackagingLevelDto } from './dto/create-packaging-level.dto';
import { UpdatePackagingLevelDto } from './dto/update-packaging-level.dto';
import { isUniqueViolation } from '../../shared/supabase/postgrest-error.util';

@Injectable()
export class ItemPackagingLevelsService {
  constructor(
    private readonly packagingRepo: ItemPackagingLevelsRepository,
    private readonly itemsRepo: ItemsRepository,
  ) {}

  async findAllForItem(itemId: string, tenantId: string) {
    const item = await this.itemsRepo.findById(itemId, tenantId);
    if (!item) throw new NotFoundException('Item not found');
    return this.packagingRepo.findAllForItem(itemId, tenantId);
  }

  async findById(id: string, tenantId: string) {
    const level = await this.packagingRepo.findById(id, tenantId);
    if (!level) throw new NotFoundException('Packaging level not found');
    return level;
  }

  async create(tenantId: string, dto: CreatePackagingLevelDto) {
    const item = await this.itemsRepo.findById(dto.item_id, tenantId);
    if (!item) throw new NotFoundException('Item not found');

    if (dto.parent_level_id) {
      const parent = await this.packagingRepo.findById(
        dto.parent_level_id,
        tenantId,
      );
      if (!parent || parent.item_id !== dto.item_id) {
        throw new NotFoundException(
          'Parent packaging level not found for this item',
        );
      }
      // A non-root level with no meaningful conversion factor is a data-
      // entry mistake, not a valid packaging step — DB only enforces
      // quantity_in_parent > 0 (which 1 satisfies), so this needs a
      // service-level check.
      if (!dto.quantity_in_parent || dto.quantity_in_parent <= 0) {
        throw new BadRequestException(
          'quantity_in_parent is required and must be > 0 for a non-root level',
        );
      }
    } else {
      // Root level: DB's chk_root_quantity_is_one CHECK also enforces this,
      // but a friendly 400 beats a raw constraint-violation 500.
      if (
        dto.quantity_in_parent !== undefined &&
        dto.quantity_in_parent !== 1
      ) {
        throw new BadRequestException(
          'quantity_in_parent must be 1 (or omitted) for the root level',
        );
      }
      const existingRoot = await this.packagingRepo.findRootForItem(
        dto.item_id,
        tenantId,
      );
      if (existingRoot) {
        throw new ConflictException(
          `Item already has a root packaging level ("${existingRoot.level_name}") — delete it before defining a different one`,
        );
      }
    }

    try {
      return await this.packagingRepo.create(tenantId, {
        item_id: dto.item_id,
        parent_level_id: dto.parent_level_id ?? null,
        level_name: dto.level_name,
        quantity_in_parent: dto.quantity_in_parent ?? 1,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          'A packaging level with this name already exists for this item',
        );
      }
      throw error;
    }
  }

  async update(id: string, tenantId: string, dto: UpdatePackagingLevelDto) {
    const existing = await this.findById(id, tenantId);

    if (dto.quantity_in_parent !== undefined) {
      if (existing.parent_level_id === null) {
        if (dto.quantity_in_parent !== 1) {
          throw new BadRequestException(
            'quantity_in_parent must remain 1 for the root level',
          );
        }
      } else if (dto.quantity_in_parent <= 0) {
        throw new BadRequestException('quantity_in_parent must be > 0');
      }
    }

    try {
      return await this.packagingRepo.update(id, tenantId, { ...dto });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          'A packaging level with this name already exists for this item',
        );
      }
      throw error;
    }
  }

  // Dependency protection: refuse to delete a level that still has child
  // levels or assigned barcodes, rather than silently cascading (the DB
  // constraint *would* cascade — ON DELETE CASCADE, migration 221 — but a
  // silent multi-row cascade from a single DELETE is exactly the kind of
  // surprise this service layer exists to prevent for a user-triggered
  // action).
  async remove(id: string, tenantId: string) {
    await this.findById(id, tenantId);

    const [hasChildren, hasBarcodes] = await Promise.all([
      this.packagingRepo.hasChildren(id, tenantId),
      this.packagingRepo.hasBarcodes(id, tenantId),
    ]);
    if (hasChildren) {
      throw new ConflictException(
        'Cannot delete a packaging level that has child levels — delete them first',
      );
    }
    if (hasBarcodes) {
      throw new ConflictException(
        'Cannot delete a packaging level with an assigned barcode — remove the barcode first',
      );
    }

    await this.packagingRepo.delete(id, tenantId);
  }

  // Read-only: resolves a packaging-level quantity into the item's
  // storage-unit-equivalent quantity via fn_convert_packaging_to_storage_qty
  // (migration 221) — used by the UI to preview "10 Cartons = X Pieces"
  // before submitting, and reused as-is by the transaction-wiring call
  // sites (invoices/goods-receipts/transfers) in Sub-phase 2b.
  async resolveQuantity(
    itemId: string,
    packagingLevelId: string,
    quantity: number,
    tenantId: string,
  ): Promise<number> {
    const level = await this.findById(packagingLevelId, tenantId);
    if (level.item_id !== itemId) {
      throw new BadRequestException(
        'Packaging level does not belong to this item',
      );
    }
    return this.packagingRepo.resolveToStorageQty(
      itemId,
      packagingLevelId,
      quantity,
    );
  }
}
