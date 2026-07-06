import { Injectable, NotFoundException } from '@nestjs/common';
import { LeaveRequestsRepository } from './repositories/leave-requests.repository';
import { TenantContext } from '../../core/tenant/tenant-context';

@Injectable()
export class LeavesService {
  constructor(private readonly leaveRequestsRepo: LeaveRequestsRepository) {}

  findAll(tenant: TenantContext, status?: 'pending' | 'approved' | 'rejected') {
    return this.leaveRequestsRepo.findAllForTenant(tenant.tenantId, status);
  }

  async updateStatus(id: string, tenant: TenantContext, status: 'approved' | 'rejected') {
    const row = await this.leaveRequestsRepo.updateStatus(id, tenant.tenantId, status);
    if (!row) throw new NotFoundException('Leave request not found');
    return row;
  }
}
