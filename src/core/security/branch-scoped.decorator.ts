import { SetMetadata } from '@nestjs/common';

export const BRANCH_SCOPED_KEY = 'branch_scoped';

export interface BranchScopedOptions {
  /**
   * Where the client-requested branch_id (if any) comes from — most reads
   * use the query string, POST /invoices' branch_id lives in the body.
   * Defaults to 'query'.
   */
  source?: 'query' | 'body';
  /**
   * 'read' | 'write' — passed straight through to
   * BranchAuthorizationService.resolveBranchScope's own `mode` parameter.
   * The resolution algorithm itself is mode-independent (see that
   * service's own doc comment) — this exists only to match its reviewed
   * signature and for future extension/telemetry, not because it changes
   * behavior today. Defaults to 'read'.
   */
  mode?: 'read' | 'write';
}

// Branch Domain Batch 1, B1 (Owner-approved) — marks a route handler as
// branch-sensitive. BranchScopeInterceptor (registered globally) only
// activates for handlers carrying this metadata, so branch-insensitive
// endpoints (auth, superadmin, permission/role admin, etc.) pay zero
// resolution cost. Read the resolved, server-authoritative scope via
// @EffectiveBranchId() in the handler — never trust the raw
// query/body branch_id directly once a route is marked @BranchScoped().
export const BranchScoped = (options: BranchScopedOptions = {}) =>
  SetMetadata(BRANCH_SCOPED_KEY, {
    source: options.source ?? 'query',
    mode: options.mode ?? 'read',
  });
