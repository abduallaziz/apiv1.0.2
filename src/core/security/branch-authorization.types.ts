// Branch System Step 4 (Owner-approved) — shared types for
// BranchAuthorizationService. Kept in their own file (framework-agnostic,
// no NestJS imports) so the decision logic and its types can be consumed
// by a future guard, a plain service call, or a unit test with zero
// coupling to HTTP/Nest concepts.

export type BranchAuthorizationMode = 'read' | 'write';

export interface BranchAuthorizationActor {
  tenantId: string;
  userId: string;
  /**
   * The acting user's own branch restriction — mirrors `users.branch_id`.
   * `null` = Central user (unrestricted within their own tenant).
   * A branch id = restricted to that single branch.
   */
  branchId: string | null;
}

export type BranchAuthorizationDenialReason =
  // Branch does not exist, is inactive, is soft-deleted, or belongs to a
  // different tenant — the exact set BranchValidatorService already checks.
  | 'branch_not_found'
  // A branch-restricted actor explicitly requested (or the loaded record
  // belongs to) a branch other than their own.
  | 'branch_mismatch';

export type BranchAuthorizationResult =
  | {
      allowed: true;
      /**
       * The scope the caller must actually use:
       * - a branch id: filter/insert/compare against exactly this branch.
       * - null: tenant-wide — only ever returned for a Central actor who
       *   omitted a requested branch, on an endpoint that supports that.
       */
      effectiveBranchId: string | null;
    }
  | {
      allowed: false;
      reason: BranchAuthorizationDenialReason;
    };
