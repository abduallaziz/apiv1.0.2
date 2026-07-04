import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { SchedulesRepository } from './repositories/schedules.repository';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { UpdateScheduleDto } from './dto/update-schedule.dto';
import { BulkCreateScheduleDto } from './dto/bulk-create-schedule.dto';
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

  async bulkCreate(tenant: TenantContext, dto: BulkCreateScheduleDto) {
    for (const userId of dto.user_ids) {
      const ok = await this.repo.userBelongsToTenant(userId, tenant.tenantId);
      if (!ok) throw new BadRequestException(`User not found: ${userId}`);
    }
    if (dto.branch_id) {
      const ok = await this.repo.branchBelongsToTenant(dto.branch_id, tenant.tenantId);
      if (!ok) throw new BadRequestException('Branch not found');
    }

    // Parsed and iterated entirely in UTC so the server's local timezone can't shift
    // scheduled_date (a plain DATE column) by a day — mixing local-time Date parsing with
    // toISOString() output previously shifted the whole range back a day on UTC+ servers.
    const parseYMD = (s: string) => {
      const [y, m, d] = s.split('-').map(Number);
      return new Date(Date.UTC(y, m - 1, d));
    };
    const from = parseYMD(dto.date_from);
    const to = parseYMD(dto.date_to);
    if (to < from) throw new BadRequestException('date_to must be on or after date_from');

    const overrideByDay = new Map((dto.day_overrides ?? []).map((o) => [o.day, o]));

    const dates: { scheduled_date: string; start_time: string; end_time: string }[] = [];
    for (let d = new Date(from); d <= to; d.setUTCDate(d.getUTCDate() + 1)) {
      const dayOfWeek = d.getUTCDay();
      if (!dto.days_of_week || dto.days_of_week.includes(dayOfWeek)) {
        const override = overrideByDay.get(dayOfWeek);
        dates.push({
          scheduled_date: d.toISOString().substring(0, 10),
          start_time: override?.start_time ?? dto.start_time,
          end_time: override?.end_time ?? dto.end_time,
        });
      }
    }
    if (dates.length === 0) return [];

    const rows = dto.user_ids.flatMap((user_id) =>
      dates.map((d) => ({
        user_id,
        branch_id: dto.branch_id,
        scheduled_date: d.scheduled_date,
        start_time: d.start_time,
        end_time: d.end_time,
      })),
    );

    return this.repo.bulkCreate(tenant.tenantId, rows);
  }
}
