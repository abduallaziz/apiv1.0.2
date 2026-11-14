import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { BranchesRepository } from './branches.repository';
import { TenantContext } from '../../core/tenant/tenant.context';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import { BillingService } from '../../core/billing/billing.service';

@Injectable()
export class BranchesService {
  constructor(
    private readonly repo: BranchesRepository,
    private readonly billingService: BillingService,
  ) {}

  async findAll(tenant: TenantContext, activeOnly = false) {
    return this.repo.findAll(tenant, activeOnly);
  }

  async findById(id: string, tenant: TenantContext) {
    const branch = await this.repo.findById(id, tenant);
    if (!branch) throw new NotFoundException('Branch not found');
    return branch;
  }

  async create(dto: CreateBranchDto, tenant: TenantContext) {
    const name = dto.name?.trim();
    if (!name) throw new BadRequestException('name should not be empty');
    if (await this.repo.nameExists(tenant, name)) {
      throw new ConflictException('A branch with this name already exists');
    }
    await this.billingService.checkBranchLimit(tenant.tenantId);
    return this.repo.create(tenant, { ...dto, name });
  }

  async update(id: string, dto: UpdateBranchDto, tenant: TenantContext) {
    const branch = await this.repo.findById(id, tenant);
    if (!branch) throw new NotFoundException('Branch not found');

    if (dto.name !== undefined) {
      dto.name = dto.name.trim();
      if (!dto.name) throw new BadRequestException('name should not be empty');
      if (await this.repo.nameExists(tenant, dto.name, id)) {
        throw new ConflictException('A branch with this name already exists');
      }
    }

    if (dto.default_warehouse_id) {
      const belongsToTenant = await this.repo.warehouseBelongsToTenant(
        dto.default_warehouse_id,
        tenant.tenantId,
      );
      if (!belongsToTenant) {
        throw new BadRequestException('Warehouse not found');
      }
    }

    const updated = await this.repo.update(id, tenant, dto);
    if (dto.name && dto.name !== branch.name) {
      await this.repo.renameAutoWarehouse(
        tenant,
        branch.default_warehouse_id as string | null,
        branch.name as string,
        dto.name,
      );
    }
    return updated;
  }

  async remove(id: string, tenant: TenantContext) {
    const branch = await this.repo.findById(id, tenant);
    if (!branch) throw new NotFoundException('Branch not found');

    const count = await this.repo.countActive(tenant);
    if (count <= 1) {
      throw new BadRequestException('Cannot delete the last active branch.');
    }

    if (await this.repo.hasOpenShift(id, tenant)) {
      throw new BadRequestException(
        'Cannot delete a branch that has an open shift.',
      );
    }
    if (await this.repo.hasHistory(id, tenant)) {
      throw new BadRequestException(
        'Cannot delete a branch that has shifts or invoices. Deactivate it instead.',
      );
    }

    await this.repo.softDelete(id, tenant);
    return { success: true };
  }
}
