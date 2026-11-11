import { Injectable, NotFoundException } from '@nestjs/common';
import { SuppliersRepository } from './repositories/suppliers.repository';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { SupplierPriceTimelineQueryDto } from './dto/supplier-price-timeline-query.dto';

@Injectable()
export class SuppliersService {
  constructor(private readonly suppliersRepo: SuppliersRepository) {}

  findAll(tenantId: string) {
    return this.suppliersRepo.findAll(tenantId);
  }

  async findById(id: string, tenantId: string) {
    const supplier = await this.suppliersRepo.findById(id, tenantId);
    if (!supplier) throw new NotFoundException('Supplier not found');
    return supplier;
  }

  create(tenantId: string, dto: CreateSupplierDto) {
    return this.suppliersRepo.create(tenantId, { ...dto });
  }

  async update(id: string, tenantId: string, dto: UpdateSupplierDto) {
    await this.findById(id, tenantId);
    return this.suppliersRepo.update(id, tenantId, { ...dto });
  }

  async remove(id: string, tenantId: string) {
    await this.findById(id, tenantId);
    await this.suppliersRepo.softDelete(id, tenantId);
  }

  async findProfileStats(id: string, tenantId: string) {
    await this.findById(id, tenantId);
    return this.suppliersRepo.findProfileStats(id, tenantId);
  }

  // #9.6 Supplier Price History & Procurement Price Timeline
  // (Owner-approved, expanded scope). Pagination is applied here, over
  // the repository's already-sorted (latest-first), already-merged
  // in-memory result — the three underlying tables are queried in full
  // for this supplier+item (a bounded set, not tenant-wide), so paginating
  // in the service layer rather than per-source-table keeps the merge
  // correct without a new DB view.
  async findPriceTimeline(
    id: string,
    tenantId: string,
    itemId: string,
    query: SupplierPriceTimelineQueryDto,
  ) {
    await this.findById(id, tenantId);
    const rows = await this.suppliersRepo.findPriceTimeline(
      tenantId,
      id,
      itemId,
      query.variant_id,
    );
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const from = (page - 1) * limit;
    return {
      data: rows.slice(from, from + limit),
      total: rows.length,
      page,
      perPage: limit,
    };
  }
}
