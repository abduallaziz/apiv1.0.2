import { Injectable, BadRequestException } from '@nestjs/common';

// 'submitted' is included alongside 'pending' because some consumers
// (e.g. purchase orders) already had an established pre-approval status
// name before adopting this engine — canApprove/canReject accept it via
// the pendingStatus param rather than forcing every consumer to rename
// their status column values to match Expenses' vocabulary.
export type ApprovalStatus =
  | 'pending'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'cancelled';

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

  canApprove(
    currentStatus: ApprovalStatus,
    pendingStatus: ApprovalStatus = 'pending',
  ): boolean {
    return currentStatus === pendingStatus;
  }

  canReject(
    currentStatus: ApprovalStatus,
    pendingStatus: ApprovalStatus = 'pending',
  ): boolean {
    return currentStatus === pendingStatus || currentStatus === 'approved';
  }
}
