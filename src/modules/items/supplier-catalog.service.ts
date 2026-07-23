import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupplierCatalogRepository } from './repositories/supplier-catalog.repository';
import { ItemBarcodesService, errorMessage } from './item-barcodes.service';
import { CreateSupplierCatalogDto } from './dto/create-supplier-catalog.dto';
import { parseCsv } from './utils/csv.util';
import { BarcodeType } from './dto/create-item-barcode.dto';

@Injectable()
export class SupplierCatalogService {
  constructor(
    private readonly catalogRepo: SupplierCatalogRepository,
    private readonly barcodesService: ItemBarcodesService,
  ) {}

  async findAll(tenantId: string, supplierId?: string) {
    return this.catalogRepo.findAll(tenantId, supplierId);
  }

  async findById(id: string, tenantId: string) {
    const row = await this.catalogRepo.findById(id, tenantId);
    if (!row) throw new NotFoundException('Supplier catalog row not found');
    return row;
  }

  async create(tenantId: string, dto: CreateSupplierCatalogDto) {
    return this.catalogRepo.create(tenantId, { ...dto });
  }

  async remove(id: string, tenantId: string) {
    await this.findById(id, tenantId);
    await this.catalogRepo.delete(id, tenantId);
  }

  // A supplier_catalog row is inert data until explicitly promoted — this
  // is that promotion. Requires item_id to already be mapped on the row
  // (matching a supplier's raw feed to a real item is a separate, manual
  // or future-connector step; this endpoint only handles the "make it a
  // real barcode" half). Reuses ItemBarcodesService.create()'s existing
  // validation/uniqueness/primary-clearing rather than duplicating it.
  async sync(id: string, tenantId: string) {
    const row = await this.findById(id, tenantId);
    if (!row.item_id) {
      throw new BadRequestException(
        'This supplier catalog row has no item_id mapped yet — map it to a real item before syncing',
      );
    }

    const created = await this.barcodesService.create(tenantId, {
      item_id: row.item_id,
      variant_id: row.variant_id ?? undefined,
      barcode: row.barcode,
      barcode_type: (row.barcode_type as BarcodeType) ?? undefined,
      is_primary: false,
    });

    await this.catalogRepo.markSynced(id, tenantId);
    return created;
  }

  // CSV import for supplier feeds: columns supplier_id/item_id/variant_id/
  // catalog_code/barcode/barcode_type. Rows land in supplier_catalog only
  // — never auto-promoted to item_barcodes, per the explicit-sync design.
  async importFromCsv(tenantId: string, fileContent: string) {
    const rows = parseCsv(fileContent);
    const results: {
      row: number;
      status: 'created' | 'error';
      message?: string;
    }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const rowNum = i + 2;
      const row = rows[i];
      if (!row['barcode']) {
        results.push({
          row: rowNum,
          status: 'error',
          message: 'Missing required column: barcode',
        });
        continue;
      }
      try {
        await this.catalogRepo.create(tenantId, {
          supplier_id: row['supplier_id'] || null,
          item_id: row['item_id'] || null,
          variant_id: row['variant_id'] || null,
          catalog_code: row['catalog_code'] || null,
          barcode: row['barcode'],
          barcode_type: row['barcode_type']?.toUpperCase() || 'EAN',
        });
        results.push({ row: rowNum, status: 'created' });
      } catch (error) {
        results.push({ row: rowNum, status: 'error', message: errorMessage(error) });
      }
    }

    return {
      results,
      created: results.filter((r) => r.status === 'created').length,
      errors: results.filter((r) => r.status === 'error').length,
    };
  }
}
