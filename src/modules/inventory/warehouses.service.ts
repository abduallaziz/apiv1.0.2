import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  WarehousesRepository,
  Warehouse,
} from './repositories/warehouses.repository';
import { ForbiddenException } from '@nestjs/common';
import { currentBranchId } from '../../core/branch-scope/branch-warehouse-scope';
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
    // Isolation: a warehouse is always created in the working branch (a foreign branch is rejected).
    const branchId = currentBranchId(tenantId);
    if (branchId && dto.branch_id && dto.branch_id !== branchId) {
      throw new ForbiddenException(
        'Warehouses can only be created in the current branch',
      );
    }
    return this.warehousesRepo.create(tenantId, {
      ...dto,
      ...(branchId ? { branch_id: branchId } : {}),
    });
  }

  async update(id: string, tenantId: string, dto: UpdateWarehouseDto) {
    await this.findById(id, tenantId);
    const branchId = currentBranchId(tenantId);
    if (branchId && dto.branch_id && dto.branch_id !== branchId) {
      throw new ForbiddenException('A warehouse cannot be moved to another branch');
    }
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
