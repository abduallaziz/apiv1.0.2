import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ItemBarcodesRepository } from './repositories/item-barcodes.repository';
import { ItemsRepository } from './repositories/items.repository';
import { CreateItemBarcodeDto } from './dto/create-item-barcode.dto';
import { UpdateItemBarcodeDto } from './dto/update-item-barcode.dto';

interface PostgrestError {
  code?: string;
}

function isPostgrestError(error: unknown): error is PostgrestError {
  return typeof error === 'object' && error !== null && 'code' in error;
}

@Injectable()
export class ItemBarcodesService {
  constructor(
    private readonly barcodesRepo: ItemBarcodesRepository,
    private readonly itemsRepo: ItemsRepository,
  ) {}

  async findAll(tenantId: string, itemId?: string, variantId?: string) {
    return this.barcodesRepo.findAll(tenantId, itemId, variantId);
  }

  async findById(id: string, tenantId: string) {
    const barcode = await this.barcodesRepo.findById(id, tenantId);
    if (!barcode) throw new NotFoundException('Barcode not found');
    return barcode;
  }

  async lookup(barcode: string, tenantId: string) {
    const result = await this.barcodesRepo.lookupByBarcode(barcode, tenantId);
    if (!result) throw new NotFoundException('No item is linked to this barcode');
    return result;
  }

  async create(tenantId: string, dto: CreateItemBarcodeDto) {
    const item = await this.itemsRepo.findById(dto.item_id, tenantId);
    if (!item) throw new NotFoundException('Item not found');

    if (dto.variant_id) {
      const variants = await this.itemsRepo.findVariants(dto.item_id, tenantId);
      const variantExists = (variants ?? []).some(
        (v: { id: string }) => v.id === dto.variant_id,
      );
      if (!variantExists)
        throw new NotFoundException('Variant not found for this item');
    }

    // Existing rows for the same item/variant are cleared BEFORE the insert
    // (not after) — insert can fail on its own (e.g. duplicate barcode) and
    // must not have already flipped an unrelated row's primary flag.
    if (dto.is_primary) {
      await this.barcodesRepo.clearPrimaryForItem(
        tenantId,
        dto.item_id,
        dto.variant_id ?? null,
      );
    }

    try {
      return await this.barcodesRepo.create(tenantId, { ...dto });
    } catch (error) {
      if (isPostgrestError(error) && error.code === '23505') {
        throw new ConflictException(
          'This barcode is already assigned to another item',
        );
      }
      throw error;
    }
  }

  async update(id: string, tenantId: string, dto: UpdateItemBarcodeDto) {
    const existing = await this.findById(id, tenantId);

    if (dto.variant_id !== undefined && dto.variant_id !== null) {
      const variants = await this.itemsRepo.findVariants(
        existing.item_id,
        tenantId,
      );
      const variantExists = (variants ?? []).some(
        (v: { id: string }) => v.id === dto.variant_id,
      );
      if (!variantExists)
        throw new NotFoundException('Variant not found for this item');
    }

    if (dto.is_primary) {
      const variantId =
        dto.variant_id !== undefined ? dto.variant_id : existing.variant_id;
      await this.barcodesRepo.clearPrimaryForItem(
        tenantId,
        existing.item_id,
        variantId ?? null,
        id,
      );
    }

    try {
      return await this.barcodesRepo.update(id, tenantId, { ...dto });
    } catch (error) {
      if (isPostgrestError(error) && error.code === '23505') {
        throw new ConflictException(
          'This barcode is already assigned to another item',
        );
      }
      throw error;
    }
  }

  async remove(id: string, tenantId: string) {
    await this.findById(id, tenantId);
    await this.barcodesRepo.delete(id, tenantId);
  }
}
