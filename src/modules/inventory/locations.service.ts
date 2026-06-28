import { Injectable, NotFoundException } from '@nestjs/common';
import { LocationsRepository } from './repositories/locations.repository';
import { WarehousesService } from './warehouses.service';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';

@Injectable()
export class LocationsService {
  constructor(
    private readonly locationsRepo: LocationsRepository,
    private readonly warehousesService: WarehousesService,
  ) {}

  async findAll(warehouseId: string, tenantId: string) {
    await this.warehousesService.findById(warehouseId, tenantId);
    return this.locationsRepo.findAll(warehouseId, tenantId);
  }

  async findById(id: string, warehouseId: string, tenantId: string) {
    const location = await this.locationsRepo.findById(id, warehouseId, tenantId);
    if (!location) throw new NotFoundException('Location not found');
    return location;
  }

  async create(warehouseId: string, tenantId: string, dto: CreateLocationDto) {
    await this.warehousesService.findById(warehouseId, tenantId);
    return this.locationsRepo.create(warehouseId, tenantId, { ...dto });
  }

  async update(id: string, warehouseId: string, tenantId: string, dto: UpdateLocationDto) {
    await this.findById(id, warehouseId, tenantId);
    return this.locationsRepo.update(id, warehouseId, tenantId, { ...dto });
  }

  async remove(id: string, warehouseId: string, tenantId: string) {
    await this.findById(id, warehouseId, tenantId);
    await this.locationsRepo.softDelete(id, warehouseId, tenantId);
  }
}
