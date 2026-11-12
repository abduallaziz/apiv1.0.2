import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  WarehousesRepository,
  Warehouse,
} from './repositories/warehouses.repository';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';

@Injectable()
export class WarehousesService {
  constructor(private readonly warehousesRepo: WarehousesRepository) {}

  findAll(tenantId: string) {
    return this.warehousesRepo.findAll(tenantId);
  }

  async findById(id: string, tenantId: string): Promise<Warehouse> {
    const warehouse = await this.warehousesRepo.findById(id, tenantId);
    if (!warehouse) throw new NotFoundException('Warehouse not found');
    return warehouse;
  }

  create(tenantId: string, dto: CreateWarehouseDto) {
    return this.warehousesRepo.create(tenantId, { ...dto });
  }

  async update(id: string, tenantId: string, dto: UpdateWarehouseDto) {
    await this.findById(id, tenantId);
    // Deactivating the default warehouse of a branch would silently stop its
    // sales from deducting stock / posting COGS.
    if (dto.is_active === false) {
      await this.assertNotBranchDefault(id, tenantId);
    }
    return this.warehousesRepo.update(id, tenantId, { ...dto });
  }

  async remove(id: string, tenantId: string) {
    await this.findById(id, tenantId);
    await this.assertNotBranchDefault(id, tenantId);
    await this.warehousesRepo.softDelete(id, tenantId);
  }

  private async assertNotBranchDefault(id: string, tenantId: string) {
    if (await this.warehousesRepo.isBranchDefault(id, tenantId)) {
      throw new BadRequestException(
        'This warehouse is the default warehouse of a branch. Assign another default warehouse to that branch first.',
      );
    }
  }
}
