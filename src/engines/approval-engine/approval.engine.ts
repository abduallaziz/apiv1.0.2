import { Injectable, BadRequestException } from '@nestjs/common';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface ApprovalResult {
  status: ApprovalStatus;
  resolvedAt: string;
  resolvedBy: string;
  reason?: string;
}

@Injectable()
export class ApprovalEngine {
  approve(approverId: string): ApprovalResult {
    return {
      status: 'approved',
      resolvedAt: new Date().toISOString(),
      resolvedBy: approverId,
    };
  }

  reject(approverId: string, reason: string): ApprovalResult {
    if (!reason || reason.trim().length === 0) {
      throw new BadRequestException('Rejection reason is required');
    }
    return {
      status: 'rejected',
      resolvedAt: new Date().toISOString(),
      resolvedBy: approverId,
      reason: reason.trim(),
    };
  }

  canApprove(currentStatus: ApprovalStatus): boolean {
    return currentStatus === 'pending';
  }

  canReject(currentStatus: ApprovalStatus): boolean {
    return currentStatus === 'pending';
  }
}