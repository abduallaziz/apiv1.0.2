import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { TablesRepository } from './repositories/tables.repository';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdateTableDto } from './dto/update-table.dto';
import { TenantContext } from '../../core/tenant/tenant-context';

@Injectable()
export class TablesService {
  constructor(private readonly repo: TablesRepository) {}

  findAll(tenant: TenantContext, branchId?: string) {
    // branch isolation: always the working branch
    const scoped = tenant.isolated && tenant.branchId ? tenant.branchId : branchId;
    return this.repo.findAll(tenant.tenantId, scoped);
  }

  async findOne(id: string, tenant: TenantContext) {
    const table = await this.repo.findById(
      id,
      tenant.tenantId,
      tenant.isolated ? tenant.branchId : null,
    );
    if (!table) throw new NotFoundException('Table not found');
    return table;
  }

  async create(tenant: TenantContext, dto: CreateTableDto) {
    const branchOk = await this.repo.branchBelongsToTenant(
      dto.branch_id,
      tenant.tenantId,
    );
    if (!branchOk) throw new BadRequestException('Branch not found');
    if (tenant.isolated && tenant.branchId && dto.branch_id !== tenant.branchId) {
      throw new BadRequestException('A table can only be created in the working branch');
    }
    return this.repo.create(tenant.tenantId, dto);
  }

  async update(id: string, tenant: TenantContext, dto: UpdateTableDto) {
    await this.findOne(id, tenant);
    return this.repo.update(id, tenant.tenantId, dto);
  }

  async remove(id: string, tenant: TenantContext) {
    const table = await this.findOne(id, tenant);
    if (table.status === 'occupied') {
      throw new BadRequestException('Cannot delete a table with an open order');
    }
    await this.repo.softDelete(id, tenant.tenantId);
  }
}
