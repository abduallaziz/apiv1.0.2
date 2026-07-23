import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ItemBarcodesRepository } from './repositories/item-barcodes.repository';
import { ItemsRepository } from './repositories/items.repository';
import { CreateItemBarcodeDto } from './dto/create-item-barcode.dto';
import { UpdateItemBarcodeDto } from './dto/update-item-barcode.dto';
import { generateEan13ForTenant } from './utils/ean13.util';
import { parseCsv } from './utils/csv.util';
import { BarcodeType } from './dto/create-item-barcode.dto';

const MAX_GENERATE_ATTEMPTS = 5;

export interface ImportRowResult {
  row: number;
  status: 'created' | 'skipped' | 'error';
  barcode?: string;
  message?: string;
}

interface PostgrestError {
  code?: string;
}

function isPostgrestError(error: unknown): error is PostgrestError {
  return typeof error === 'object' && error !== null && 'code' in error;
}

// Supabase/Postgrest errors are plain objects, not Error instances —
// String(error) on those yields "[object Object]" (same class of bug
// already fixed once this session in invoices.service.ts). Extract the
// real message field explicitly instead.
export function errorMessage(error: unknown): string {
  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof (error as { message: unknown }).message === 'string'
  ) {
    return (error as { message: string }).message;
  }
  return String(error);
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
    if (!result)
      throw new NotFoundException('No item is linked to this barcode');
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

  // In-system automation: called right after an item/variant is created
  // with no barcode explicitly supplied (items/variants have no barcode
  // field on their own create DTOs — every new one qualifies). Only
  // assigns primary if the item/variant genuinely has none yet, so this
  // is safe to call defensively without risking a duplicate primary.
  // Best-effort: a failure here must never block item/variant creation
  // itself, so callers should catch and log rather than let this throw
  // up through the create() response.
  async generateForItem(
    tenantId: string,
    itemId: string,
    variantId: string | null,
  ) {
    const alreadyHasPrimary = await this.barcodesRepo.hasPrimaryForItem(
      tenantId,
      itemId,
      variantId,
    );

    for (let attempt = 0; attempt < MAX_GENERATE_ATTEMPTS; attempt++) {
      const seq = await this.barcodesRepo.nextSequence(tenantId);
      const barcode = generateEan13ForTenant(tenantId, seq);
      try {
        return await this.barcodesRepo.create(tenantId, {
          item_id: itemId,
          variant_id: variantId,
          barcode,
          barcode_type: 'EAN',
          is_primary: !alreadyHasPrimary,
        });
      } catch (error) {
        if (isPostgrestError(error) && error.code === '23505') {
          continue; // extremely rare tenant-hash/sequence collision — retry with next seq
        }
        throw error;
      }
    }
    throw new Error(
      `Failed to generate a unique barcode for item ${itemId} after ${MAX_GENERATE_ATTEMPTS} attempts`,
    );
  }

  // CSV import: one row per barcode, columns item_id/variant_id/barcode/
  // barcode_type/is_primary (case-insensitive header). Reuses create()'s
  // existing validation (item/variant existence, uniqueness, primary
  // clearing) per row rather than duplicating it — a bad row never
  // aborts the whole file, it's just reported as an error for that row.
  async importFromCsv(
    tenantId: string,
    fileContent: string,
  ): Promise<{ results: ImportRowResult[]; created: number; errors: number }> {
    const rows = parseCsv(fileContent);
    const results: ImportRowResult[] = [];

    for (let i = 0; i < rows.length; i++) {
      const rowNum = i + 2; // +1 for header, +1 for 1-indexing
      const row = rows[i];
      const itemId = row['item_id'];
      const barcode = row['barcode'];

      if (!itemId || !barcode) {
        results.push({
          row: rowNum,
          status: 'error',
          message:
            'Missing required column: item_id and barcode are both required',
        });
        continue;
      }

      const barcodeType = row['barcode_type']?.toUpperCase();
      const isValidType =
        !barcodeType ||
        Object.values(BarcodeType).includes(barcodeType as BarcodeType);
      if (!isValidType) {
        results.push({
          row: rowNum,
          status: 'error',
          message: `Invalid barcode_type "${row['barcode_type']}" — must be one of ${Object.values(BarcodeType).join(', ')}`,
        });
        continue;
      }

      try {
        const created = await this.create(tenantId, {
          item_id: itemId,
          variant_id: row['variant_id'] || undefined,
          barcode,
          barcode_type: (barcodeType as BarcodeType) || undefined,
          is_primary: row['is_primary']?.toLowerCase() === 'true',
        });
        results.push({
          row: rowNum,
          status: 'created',
          barcode: created.barcode,
        });
      } catch (error) {
        results.push({ row: rowNum, status: 'error', barcode, message: errorMessage(error) });
      }
    }

    return {
      results,
      created: results.filter((r) => r.status === 'created').length,
      errors: results.filter((r) => r.status === 'error').length,
    };
  }
}
