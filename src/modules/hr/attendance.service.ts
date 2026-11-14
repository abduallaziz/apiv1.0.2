import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { AttendanceRepository } from './repositories/attendance.repository';
import { TenantContext } from '../../core/tenant/tenant-context';
import { HrBranchService } from './hr-branch.service';

@Injectable()
export class AttendanceService {
  constructor(
    private readonly repo: AttendanceRepository,
    private readonly hrBranch: HrBranchService,
  ) {}

  async checkIn(
    tenant: TenantContext,
    userId: string,
    branchId: string | null,
  ) {
    const open = await this.repo.findOpenRecord(tenant.tenantId, userId);
    if (open) {
      throw new BadRequestException('Already checked in — check out first');
    }
    if (tenant.isolated) {
      // The check-in branch is the employee's own branch (never taken from the request body); a central
      // user without a branch of their own works in the branch they are currently in.
      branchId =
        (await this.repo.findUserBranch(tenant.tenantId, userId)) ??
        tenant.branchId;
    }
    if (branchId) {
      const branchOk = await this.repo.branchBelongsToTenant(
        branchId,
        tenant.tenantId,
      );
      if (!branchOk) throw new BadRequestException('Branch not found');
    }
    return this.repo.checkIn(tenant.tenantId, userId, branchId);
  }

  async checkOut(tenant: TenantContext, userId: string) {
    const open = await this.repo.findOpenRecord(tenant.tenantId, userId);
    if (!open) {
      throw new NotFoundException('No open attendance record to check out of');
    }
    return this.repo.checkOut(tenant.tenantId, open.id);
  }

  async findAll(
    tenant: TenantContext,
    filters: { userId?: string; branchId?: string; from?: string; to?: string },
  ) {
    return this.repo.findAll(tenant, filters);
  }

  async createException(
    tenant: TenantContext,
    userId: string,
    dateFrom: string,
    dateTo: string,
    reason: string,
    createdBy: string,
  ) {
    const exceptionBranch = await this.hrBranch.branchOfEmployee(tenant, userId);
    // Parsed/iterated in UTC — see the identical note in SchedulesService.bulkCreate.
    const parseYMD = (s: string) => {
      const [y, m, d] = s.split('-').map(Number);
      return new Date(Date.UTC(y, m - 1, d));
    };
    const from = parseYMD(dateFrom);
    const to = parseYMD(dateTo);
    if (to < from)
      throw new BadRequestException('date_to must be on or after date_from');

    const dates: string[] = [];
    for (let d = new Date(from); d <= to; d.setUTCDate(d.getUTCDate() + 1)) {
      dates.push(d.toISOString().substring(0, 10));
    }

    return this.repo.createExceptions(
      tenant.tenantId,
      userId,
      dates,
      reason,
      createdBy,
      exceptionBranch,
    );
  }

  async findExceptions(
    tenant: TenantContext,
    filters: { userId?: string; from?: string; to?: string },
  ) {
    return this.repo.findExceptions(tenant, filters);
  }
}
