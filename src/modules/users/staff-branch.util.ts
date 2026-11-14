import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { TenantContext } from '../../core/tenant/tenant.context';

/** Roles that stay central (users.branch_id = NULL) even under branch isolation. */
const CENTRAL_ROLES = new Set(['owner', 'superadmin']);

/**
 * Branch a NEW user/employee must be stamped with.
 * - isolation off: legacy behaviour (the DTO value or null);
 * - isolation on: central roles stay NULL; everyone else gets the working branch and may not
 *   be created for a different branch than the one the request works in.
 */
export function resolveNewStaffBranch(
  tenant: TenantContext,
  role: string,
  dtoBranchId: string | null | undefined,
): string | null {
  if (!tenant.isolated) return dtoBranchId ?? null;
  if (CENTRAL_ROLES.has(role)) return null;
  const branch = dtoBranchId ?? tenant.branchId;
  if (!branch || branch !== tenant.branchId) {
    throw new BadRequestException(
      'Employees must belong to the branch you are working in',
    );
  }
  return branch;
}

/**
 * Validates a branch change on an existing user under isolation. Only central actors
 * (owner/admin, users.branch_id NULL) may move people between branches, and a non-central
 * user can never be left without a branch.
 */
export function assertBranchChangeAllowed(
  tenant: TenantContext,
  role: string,
  currentBranchId: string | null,
  newBranchId: string | null | undefined,
  actorIsCentral: boolean,
): void {
  if (!tenant.isolated || newBranchId === undefined) return;
  if (newBranchId === currentBranchId) return;
  if (newBranchId === null && !CENTRAL_ROLES.has(role)) {
    throw new BadRequestException('An employee must belong to a branch');
  }
  if (!actorIsCentral) {
    throw new ForbiddenException(
      'Only the owner can move an employee to another branch',
    );
  }
}
