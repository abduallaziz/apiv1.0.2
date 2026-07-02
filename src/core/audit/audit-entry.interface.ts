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
}