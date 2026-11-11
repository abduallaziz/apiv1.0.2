import { Injectable } from '@nestjs/common';
import { BranchValidatorService } from './branch-validator.service';
import {
  BranchAuthorizationActor,
  BranchAuthorizationMode,
  BranchAuthorizationResult,
} from './branch-authorization.types';

// Branch System Step 4 (Owner-approved) — the single reusable
// branch-authorization decision point. No module may re-implement this
// logic; every branch-scoped module's future Axis-2 migration calls into
// this service instead. Deliberately has no NestJS request/guard coupling
// beyond @Injectable() itself — every method takes plain data in, returns
// plain data out, so it is trivially unit-testable and safe for a future
// BranchScopeGuard to wrap without redesign.
//
// This service makes ALLOW/DENY decisions. It never throws an HTTP
// exception itself and never decides which HTTP status a denial becomes
// (403 vs 404 depends on context — e.g. a detail-by-id read must return
// 404 to avoid confirming a record's existence, while a list/create
// rejection is a 403) — that translation is the caller's job.
//
// Caller gotcha (found migrating /reports/revenue): this project runs with
// strictNullChecks off, which degrades TS's discriminated-union narrowing
// on BranchAuthorizationResult — `if (!result.allowed) { result.reason }`
// does not type-check even though it's correct at runtime. Read `reason`
// via `(result as { reason: string }).reason` inside that branch instead
// of relying on narrowing.
//
// Reuses BranchValidatorService for "does this branch exist, belong to
// this tenant, and is it active" rather than duplicating that query —
// this service only adds the actor-vs-branch comparison BranchValidatorService
// was never able to make (it has no concept of the acting user at all).
@Injectable()
export class BranchAuthorizationService {
  constructor(private readonly branchValidator: BranchValidatorService) {}

  /**
   * Resolves what branch scope a request is actually authorized to use,
   * given what branch (if any) was requested.
   *
   * `mode` does not change the resolution algorithm itself — a mismatch is
   * rejected identically for read and write (see the module comment: this
   * service never silently rewrites a mismatched request, on read or
   * write). `mode` exists for callers/telemetry/future extension, and to
   * match the exact reviewed signature; documented here so it is not
   * mistaken for a missed branch in the logic.
   */
  async resolveBranchScope(
    actor: BranchAuthorizationActor,
    requestedBranchId: string | null | undefined,
    mode: BranchAuthorizationMode,
  ): Promise<BranchAuthorizationResult> {
    void mode; // documented above: intentionally unused, algorithm is mode-independent
    const isCentral = actor.branchId === null;
    const hasRequestedBranch =
      requestedBranchId !== null && requestedBranchId !== undefined;

    if (isCentral) {
      if (!hasRequestedBranch) {
        // Central + omitted → tenant-wide is allowed; the endpoint decides
        // whether it actually supports a tenant-wide scope.
        return { allowed: true, effectiveBranchId: null };
      }
      const valid = await this.branchExists(requestedBranchId, actor.tenantId);
      if (!valid) return { allowed: false, reason: 'branch_not_found' };
      return { allowed: true, effectiveBranchId: requestedBranchId };
    }

    // Restricted actor.
    const ownBranchId = actor.branchId;

    if (hasRequestedBranch && requestedBranchId !== ownBranchId) {
      // Never silently rewrite a mismatched request to the actor's own
      // branch — a restricted user's explicit "give me/create for branch
      // B" while their own branch is A is a hard reject, not a correction.
      return { allowed: false, reason: 'branch_mismatch' };
    }

    // Either the requested branch matches the actor's own branch, or none
    // was requested at all — either way the effective scope is the
    // actor's own branch. Re-validate it still exists/active/tenant-owned
    // as defense in depth (e.g. the actor's own branch could have been
    // deactivated since their token was issued).
    const valid = await this.branchExists(ownBranchId, actor.tenantId);
    if (!valid) return { allowed: false, reason: 'branch_not_found' };
    return { allowed: true, effectiveBranchId: ownBranchId };
  }

  /**
   * For update/delete/cancel/state-transition and detail-by-id reads,
   * where the relevant branch is the one already stored on the loaded
   * record, not something the client is requesting. `recordBranchId` may
   * be null for legacy/tenant-wide records that predate branch scoping —
   * treated as accessible to everyone in the tenant (nothing to restrict
   * against), same as a Central actor's tenant-wide scope.
   */
  authorizeRecordAccess(
    actor: BranchAuthorizationActor,
    recordBranchId: string | null,
  ): Promise<BranchAuthorizationResult> {
    if (actor.branchId === null) {
      // Central — the record was already loaded within the actor's own
      // tenant (that check happens upstream, same as it does today), so
      // there is nothing further to restrict here.
      return Promise.resolve({
        allowed: true,
        effectiveBranchId: recordBranchId,
      });
    }

    if (recordBranchId === null) {
      // A tenant-wide/legacy record has no branch to conflict with.
      return Promise.resolve({ allowed: true, effectiveBranchId: null });
    }

    if (recordBranchId !== actor.branchId) {
      return Promise.resolve({ allowed: false, reason: 'branch_mismatch' });
    }

    return Promise.resolve({
      allowed: true,
      effectiveBranchId: recordBranchId,
    });
  }

  private async branchExists(
    branchId: string,
    tenantId: string,
  ): Promise<boolean> {
    try {
      await this.branchValidator.validate(branchId, tenantId);
      return true;
    } catch {
      return false;
    }
  }
}
