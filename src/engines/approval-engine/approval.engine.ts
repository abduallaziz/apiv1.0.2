import { Injectable, BadRequestException } from '@nestjs/common';

// The engine's own OUTPUT contract — approve()/reject() always resolve to
// exactly one of these two, regardless of which module calls them. This is
// NOT the module's full status vocabulary (draft/submitted/pending/
// under_review/... are entirely up to each consumer) — it's just what a
// single approve/reject decision itself always produces.
export type ApprovalOutcome = 'approved' | 'rejected';

export interface ApprovalResult {
  status: ApprovalOutcome;
  resolvedAt: string;
  resolvedBy: string;
  reason?: string;
}

// Deliberately generic: a consuming module's pre-approval status name
// (Expenses: 'pending', purchase orders: 'submitted', a future RFQ:
// 'under_review', anything) is passed in by the caller as a plain string —
// the engine never needs to know or enumerate it. Adding a new consumer
// with its own status vocabulary requires zero changes to this file.
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
    currentStatus: string,
    pendingStatus: string = 'pending',
  ): boolean {
    return currentStatus === pendingStatus;
  }

  canReject(currentStatus: string, pendingStatus: string = 'pending'): boolean {
    return currentStatus === pendingStatus || currentStatus === 'approved';
  }
}
