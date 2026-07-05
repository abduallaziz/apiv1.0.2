import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { ShiftPatternsRepository } from './repositories/shift-patterns.repository';
import { SchedulesRepository } from './repositories/schedules.repository';
import { SchedulesService } from './schedules.service';
import { CreateShiftPatternDto, UpdateShiftPatternDto } from './dto/shift-pattern.dto';
import { AssignScheduleDto } from './dto/assign-schedule.dto';
import { TenantContext } from '../../core/tenant/tenant-context';

// How far ahead schedule rows are materialized. There's no end date by
// design (employment is treated as indefinite), so instead of asking for a
// date_to up front, every assignment/regeneration just fills the next two
// years — comfortably longer than anyone reviews a schedule for, and cheap
// to re-run (regeneration only touches future rows, see deleteFrom).
const ROLLING_WINDOW_DAYS = 730;

function today(): string {
  return new Date().toISOString().substring(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().substring(0, 10);
}

@Injectable()
export class ShiftPatternsService {
  constructor(
    private readonly repo: ShiftPatternsRepository,
    private readonly schedulesRepo: SchedulesRepository,
    private readonly schedulesService: SchedulesService,
  ) {}

  findAll(tenant: TenantContext) {
    return this.repo.findAll(tenant.tenantId!);
  }

  async findOne(id: string, tenant: TenantContext) {
    const pattern = await this.repo.findById(id, tenant.tenantId!);
    if (!pattern) throw new NotFoundException('Shift pattern not found');
    return pattern;
  }

  create(tenant: TenantContext, dto: CreateShiftPatternDto) {
    return this.repo.create(tenant.tenantId!, dto);
  }

  async update(id: string, tenant: TenantContext, dto: UpdateShiftPatternDto) {
    await this.findOne(id, tenant);
    const updated = await this.repo.update(id, tenant.tenantId!, dto);

    // Propagate the change to everyone assigned to this pattern — this is
    // the whole point of a shared pattern: edit once, every assignee's
    // future schedule rows reflect it immediately.
    const userIds = await this.repo.findAssignedUserIds(id, tenant.tenantId!);
    if (userIds.length > 0) {
      await this.regenerate(tenant, userIds, {
        days_of_week: updated.days_of_week,
        shifts: updated.shifts,
        day_overrides: updated.day_overrides,
      });
    }

    return updated;
  }

  async remove(id: string, tenant: TenantContext) {
    await this.findOne(id, tenant);
    const userIds = await this.repo.findAssignedUserIds(id, tenant.tenantId!);
    await this.repo.remove(id, tenant.tenantId!);

    if (userIds.length > 0) {
      // Pattern is gone — clear the assignment and stop generating future
      // schedule rows for whoever was using it (past rows are left alone).
      await this.repo.updateUsersSchedule(userIds, tenant.tenantId!, {
        shift_pattern_id: null,
        schedule_start_date: null,
      });
      await this.schedulesRepo.deleteFrom(tenant.tenantId!, userIds, today());
    }
  }

  async assign(tenant: TenantContext, dto: AssignScheduleDto) {
    if (!dto.shift_pattern_id === !dto.custom) {
      throw new BadRequestException('Provide exactly one of shift_pattern_id or custom');
    }

    for (const userId of dto.user_ids) {
      const ok = await this.schedulesRepo.userBelongsToTenant(userId, tenant.tenantId!);
      if (!ok) throw new BadRequestException(`User not found: ${userId}`);
    }

    let resolved: { days_of_week: number[]; shifts: object[]; day_overrides?: object[] };
    let userFields: Record<string, any>;

    if (dto.shift_pattern_id) {
      const pattern = await this.findOne(dto.shift_pattern_id, tenant);
      resolved = pattern;
      userFields = {
        shift_pattern_id: pattern.id,
        custom_days_of_week: null,
        custom_shifts: null,
        custom_day_overrides: null,
        schedule_start_date: dto.schedule_start_date,
      };
    } else {
      resolved = dto.custom!;
      userFields = {
        shift_pattern_id: null,
        custom_days_of_week: dto.custom!.days_of_week,
        custom_shifts: dto.custom!.shifts,
        custom_day_overrides: dto.custom!.day_overrides ?? [],
        schedule_start_date: dto.schedule_start_date,
      };
    }

    await this.repo.updateUsersSchedule(dto.user_ids, tenant.tenantId!, userFields);
    await this.regenerate(tenant, dto.user_ids, resolved, dto.schedule_start_date);

    return { assigned: dto.user_ids.length };
  }

  private async regenerate(
    tenant: TenantContext,
    userIds: string[],
    pattern: { days_of_week: number[]; shifts: object[]; day_overrides?: object[] },
    scheduleStartDate?: string,
  ) {
    const now = today();
    const from = scheduleStartDate && scheduleStartDate > now ? scheduleStartDate : now;

    await this.schedulesRepo.deleteFrom(tenant.tenantId!, userIds, now);
    await this.schedulesService.bulkCreate(tenant, {
      user_ids: userIds,
      date_from: from,
      date_to: addDays(now, ROLLING_WINDOW_DAYS),
      days_of_week: pattern.days_of_week,
      shifts: pattern.shifts,
      day_overrides: (pattern.day_overrides as any) ?? [],
    } as any);
  }
}
