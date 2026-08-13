import { Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';

export interface ScannerAuditLogPayload {
  actor_type: 'device' | 'user';
  actor_id: string;
  action: string;
  entity_type: string;
  entity_id?: string | null;
  details?: Record<string, unknown>;
}

@Injectable()
export class ScannerAuditLogsRepository extends ScopedRepository {
  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  // scanner_audit_logs is an immutable, append-only ledger (migration 172)
  // — this is the only write method this repository has.
  async create(tenantId: string, payload: ScannerAuditLogPayload) {
    const { data, error } = await this.supabase
      .from('scanner_audit_logs')
      .insert({ tenant_id: tenantId, details: {}, ...payload })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async findByEntity(tenantId: string, entityType: string, entityId: string) {
    const { data, error } = await this.supabase
      .from('scanner_audit_logs')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('entity_type', entityType)
      .eq('entity_id', entityId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data;
  }
}
