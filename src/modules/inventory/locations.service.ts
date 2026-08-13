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

  async findAll(
    warehouseId: string,
    tenantId: string,
    options: {
      search?: string;
      page?: number;
      limit?: number;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
      isActive?: boolean;
    } = {},
  ) {
    await this.warehousesService.findById(warehouseId, tenantId);
    return this.locationsRepo.findAll(warehouseId, tenantId, options);
  }

  async findById(id: string, warehouseId: string, tenantId: string) {
    const location = await this.locationsRepo.findById(
      id,
      warehouseId,
      tenantId,
    );
    if (!location) throw new NotFoundException('Location not found');
    return location;
  }

  async restrictions(id: string, warehouseId: string, tenantId: string) {
    await this.findById(id, warehouseId, tenantId);
    return this.locationsRepo.getRestrictions(tenantId, id);
  }

  async create(warehouseId: string, tenantId: string, dto: CreateLocationDto) {
    await this.warehousesService.findById(warehouseId, tenantId);
    const { restricted_to_item_ids, restricted_to_category_ids, ...rest } = dto;
    const location = await this.locationsRepo.create(warehouseId, tenantId, {
      ...rest,
    });
    if (restricted_to_item_ids?.length || restricted_to_category_ids?.length) {
      await this.locationsRepo.setRestrictions(
        tenantId,
        location.id,
        restricted_to_item_ids ?? [],
        restricted_to_category_ids ?? [],
      );
    }
    return location;
  }

  async update(
    id: string,
    warehouseId: string,
    tenantId: string,
    dto: UpdateLocationDto,
  ) {
    await this.findById(id, warehouseId, tenantId);
    const { restricted_to_item_ids, restricted_to_category_ids, ...rest } = dto;
    const location = await this.locationsRepo.update(
      id,
      warehouseId,
      tenantId,
      { ...rest },
    );
    if (
      restricted_to_item_ids !== undefined ||
      restricted_to_category_ids !== undefined
    ) {
      await this.locationsRepo.setRestrictions(
        tenantId,
        id,
        restricted_to_item_ids ?? [],
        restricted_to_category_ids ?? [],
      );
    }
    return location;
  }

  async remove(id: string, warehouseId: string, tenantId: string) {
    await this.findById(id, warehouseId, tenantId);
    await this.locationsRepo.softDelete(id, warehouseId, tenantId);
  }
}
