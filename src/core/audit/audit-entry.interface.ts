export interface AuditEntry {
  tenant_id: string | null;
  actor_id: string;
  actor_role?: string;
  action: string;
  resource_type: string;
  resource_id?: string;
  before_data?: Record<string, unknown>;
  after_data?: Record<string, unknown>;
  ip_address?: string;
  device?: string;
  // Branch System Step 5 (Owner-approved). Optional and defaults to null
  // (AuditService.log()) — omitting it is the correct, deliberate choice
  // for genuinely tenant-wide actions, not a shortcut: only pass a value
  // when the audited resource actually has one (see branch-authorization
  // audit findings — resource branch, never the actor's current branch,
  // for historical accuracy).
  branch_id?: string | null;
}
