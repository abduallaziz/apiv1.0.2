import { Injectable, NotFoundException } from '@nestjs/common';
import { SupplierItemsRepository } from './repositories/supplier-items.repository';
import { SuppliersService } from './suppliers.service';
import { ItemsService } from '../items/items.service';
import { CreateSupplierItemDto } from './dto/create-supplier-item.dto';
import { UpdateSupplierItemDto } from './dto/update-supplier-item.dto';

@Injectable()
export class SupplierItemsService {
  constructor(
    private readonly supplierItemsRepo: SupplierItemsRepository,
    private readonly suppliersService: SuppliersService,
    private readonly itemsService: ItemsService,
  ) {}

  async findAll(tenantId: string, supplierId: string) {
    await this.suppliersService.findById(supplierId, tenantId); // throws NotFoundException if missing
    return this.supplierItemsRepo.findAll(tenantId, supplierId);
  }

  async findById(id: string, tenantId: string, supplierId: string) {
    const row = await this.supplierItemsRepo.findById(id, tenantId, supplierId);
    if (!row) throw new NotFoundException('Supplier item configuration not found');
    return row;
  }

  async create(tenantId: string, supplierId: string, dto: CreateSupplierItemDto) {
    await this.suppliersService.findById(supplierId, tenantId); // throws NotFoundException if missing
    await this.itemsService.findById(dto.item_id, tenantId); // throws NotFoundException if missing

    return this.supplierItemsRepo.create(tenantId, supplierId, {
      item_id: dto.item_id,
      variant_id: dto.variant_id ?? null,
      lead_time_days: dto.lead_time_days ?? null,
      minimum_order_quantity: dto.minimum_order_quantity ?? null,
      is_preferred: dto.is_preferred ?? false,
    });
  }

  async update(id: string, tenantId: string, supplierId: string, dto: UpdateSupplierItemDto) {
    await this.findById(id, tenantId, supplierId); // 404 if missing
    const updated = await this.supplierItemsRepo.update(id, tenantId, supplierId, { ...dto });
    if (!updated) throw new NotFoundException('Supplier item configuration not found');
    return updated;
  }

  async remove(id: string, tenantId: string, supplierId: string) {
    await this.findById(id, tenantId, supplierId); // 404 if missing
    await this.supplierItemsRepo.remove(id, tenantId, supplierId);
  }
}
