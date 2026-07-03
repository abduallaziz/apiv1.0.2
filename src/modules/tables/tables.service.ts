import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { TablesRepository } from './repositories/tables.repository';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdateTableDto } from './dto/update-table.dto';
import { TenantContext } from '../../core/tenant/tenant-context';

@Injectable()
export class TablesService {
  constructor(private readonly repo: TablesRepository) {}

  findAll(tenant: TenantContext, branchId?: string) {
    return this.repo.findAll(tenant.tenantId, branchId);
  }

  async findOne(id: string, tenant: TenantContext) {
    const table = await this.repo.findById(id, tenant.tenantId);
    if (!table) throw new NotFoundException('Table not found');
    return table;
  }

  async create(tenant: TenantContext, dto: CreateTableDto) {
    const branchOk = await this.repo.branchBelongsToTenant(dto.branch_id, tenant.tenantId);
    if (!branchOk) throw new BadRequestException('Branch not found');
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
