import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LeaveRequestsRepository } from './repositories/leave-requests.repository';
import { AuditService } from '../../core/audit/audit.service';
import { TenantContext } from '../../core/tenant/tenant-context';

@Injectable()
export class LeavesService {
  constructor(
    private readonly leaveRequestsRepo: LeaveRequestsRepository,
    private readonly audit: AuditService,
  ) {}

  findAll(
    tenant: TenantContext,
    status?: 'pending' | 'approved' | 'rejected',
    userId?: string,
  ) {
    return this.leaveRequestsRepo.findAllForTenant(
      tenant.tenantId,
      status,
      userId,
    );
  }

  async updateStatus(
    id: string,
    tenant: TenantContext,
    status: 'approved' | 'rejected',
    meta?: { reason?: string; actorId?: string; actorRole?: string },
  ) {
    if (status === 'approved') {
      const current = await this.leaveRequestsRepo.findById(
        id,
        tenant.tenantId,
      );
      if (!current) throw new NotFoundException('Leave request not found');
      const overlapping = await this.leaveRequestsRepo.findOverlapping(
        tenant.tenantId,
        current.user_id,
        current.date_from,
        current.date_to,
        id,
      );
      if (
        overlapping.some((o: { status: string }) => o.status === 'approved')
      ) {
        throw new BadRequestException(
          'Leave request overlaps an already approved request',
        );
      }
    }
    const row = await this.leaveRequestsRepo.updateStatus(
      id,
      tenant.tenantId,
      status,
    );
    if (!row) throw new NotFoundException('Leave request not found');
    if (status === 'rejected' && meta?.reason?.trim()) {
      // leave_requests has no rejection-reason column (no schema change allowed): keep it in the audit log.
      this.audit
        .log({
          tenant_id: tenant.tenantId,
          actor_id: meta.actorId,
          actor_role: meta.actorRole,
          action: 'leave.request.reject_reason',
          resource_type: 'leave',
          resource_id: id,
          after_data: { reason: meta.reason.trim() },
        })
        .catch(() => {});
    }
    return row;
  }
}
