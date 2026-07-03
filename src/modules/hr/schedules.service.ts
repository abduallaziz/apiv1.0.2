import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { SchedulesRepository } from './repositories/schedules.repository';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { UpdateScheduleDto } from './dto/update-schedule.dto';
import { TenantContext } from '../../core/tenant/tenant-context';

@Injectable()
export class SchedulesService {
  constructor(private readonly repo: SchedulesRepository) {}

  findAll(
    tenant: TenantContext,
    filters: { userId?: string; branchId?: string; from?: string; to?: string },
  ) {
    return this.repo.findAll(tenant, filters);
  }

  async findOne(id: string, tenant: TenantContext) {
    const schedule = await this.repo.findById(id, tenant.tenantId);
    if (!schedule) throw new NotFoundException('Schedule not found');
    return schedule;
  }

  async create(tenant: TenantContext, dto: CreateScheduleDto) {
    const userOk = await this.repo.userBelongsToTenant(dto.user_id, tenant.tenantId);
    if (!userOk) throw new BadRequestException('User not found');

    if (dto.branch_id) {
      const branchOk = await this.repo.branchBelongsToTenant(dto.branch_id, tenant.tenantId);
      if (!branchOk) throw new BadRequestException('Branch not found');
    }

    return this.repo.create(tenant.tenantId, dto);
  }

  async update(id: string, tenant: TenantContext, dto: UpdateScheduleDto) {
    await this.findOne(id, tenant);

    if (dto.branch_id) {
      const branchOk = await this.repo.branchBelongsToTenant(dto.branch_id, tenant.tenantId);
      if (!branchOk) throw new BadRequestException('Branch not found');
    }

    return this.repo.update(id, tenant.tenantId, dto);
  }

  async remove(id: string, tenant: TenantContext) {
    await this.findOne(id, tenant);
    await this.repo.remove(id, tenant.tenantId);
  }
}
