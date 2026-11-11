import { Injectable, NotFoundException } from '@nestjs/common';
import { LocationsRepository } from './repositories/locations.repository';
import { WarehousesService } from './warehouses.service';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { AuditService } from '../../core/audit/audit.service';

@Injectable()
export class LocationsService {
  constructor(
    private readonly locationsRepo: LocationsRepository,
    private readonly warehousesService: WarehousesService,
    private readonly auditService: AuditService,
  ) {}

  // Branch System Step 5 (Owner-approved) — see identical helper in
  // ProductionOrdersService. A location's warehouseId is always present
  // here (it's a required route param), but this stays null-safe like
  // every other instance of this pattern.
  private async resolveBranchForWarehouse(
    warehouseId: string | null | undefined,
    tenantId: string,
  ): Promise<string | null> {
    if (!warehouseId) return null;
    try {
      const warehouse = await this.warehousesService.findById(
        warehouseId,
        tenantId,
      );
      return warehouse?.branch_id ?? null;
    } catch {
      return null;
    }
  }

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
      locationType?: string;
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

  async create(
    warehouseId: string,
    tenantId: string,
    dto: CreateLocationDto,
    actorId: string,
  ) {
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

    await this.auditService
      .log({
        tenant_id: tenantId,
        actor_id: actorId,
        action: 'location.create',
        resource_type: 'location',
        resource_id: location.id,
        branch_id: await this.resolveBranchForWarehouse(
          warehouseId,
          tenantId,
        ),
      })
      .catch(() => {});

    return location;
  }

  async update(
    id: string,
    warehouseId: string,
    tenantId: string,
    dto: UpdateLocationDto,
    actorId: string,
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

    await this.auditService
      .log({
        tenant_id: tenantId,
        actor_id: actorId,
        action: 'location.update',
        resource_type: 'location',
        resource_id: id,
        branch_id: await this.resolveBranchForWarehouse(
          warehouseId,
          tenantId,
        ),
      })
      .catch(() => {});

    return location;
  }

  async remove(
    id: string,
    warehouseId: string,
    tenantId: string,
    actorId: string,
  ) {
    await this.findById(id, warehouseId, tenantId);
    await this.locationsRepo.softDelete(id, warehouseId, tenantId);

    await this.auditService
      .log({
        tenant_id: tenantId,
        actor_id: actorId,
        action: 'location.delete',
        resource_type: 'location',
        resource_id: id,
        branch_id: await this.resolveBranchForWarehouse(
          warehouseId,
          tenantId,
        ),
      })
      .catch(() => {});
  }
}
