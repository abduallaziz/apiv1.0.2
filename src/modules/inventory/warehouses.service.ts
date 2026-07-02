import { Injectable, NotFoundException } from '@nestjs/common';
import { WarehousesRepository } from './repositories/warehouses.repository';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';

@Injectable()
export class WarehousesService {
  constructor(private readonly warehousesRepo: WarehousesRepository) {}

  findAll(tenantId: string) {
    return this.warehousesRepo.findAll(tenantId);
  }

  async findById(id: string, tenantId: string) {
    const warehouse = await this.warehousesRepo.findById(id, tenantId);
    if (!warehouse) throw new NotFoundException('Warehouse not found');
    return warehouse;
  }

  create(tenantId: string, dto: CreateWarehouseDto) {
    return this.warehousesRepo.create(tenantId, { ...dto });
  }

  async update(id: string, tenantId: string, dto: UpdateWarehouseDto) {
    await this.findById(id, tenantId);
    return this.warehousesRepo.update(id, tenantId, { ...dto });
  }

  async remove(id: string, tenantId: string) {
    await this.findById(id, tenantId);
    await this.warehousesRepo.softDelete(id, tenantId);
  }
}
