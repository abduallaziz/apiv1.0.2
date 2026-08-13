import { Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';

// scanner_actions (migration 172) is a mutable audit trail — unlike
// scanner_events/scanner_audit_logs, it has no immutability trigger,
// because a single action attempt legitimately has a lifecycle
// (pending -> success/failed) tracked on one row, not a new row per
// transition.
@Injectable()
export class ScannerActionsRepository extends ScopedRepository {
  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  async create(
    tenantId: string,
    payload: {
      event_id: string | null;
      action_type: string;
      target_service: string;
      target_reference_type: string | null;
      target_reference_id: string | null;
    },
  ): Promise<{ id: string }> {
    const { data, error } = await this.supabase
      .from('scanner_actions')
      .insert({ tenant_id: tenantId, status: 'pending', ...payload })
      .select()
      .single();
    if (error) throw error;
    return data as { id: string };
  }

  async markSuccess(
    id: string,
    tenantId: string,
    resultSummary: Record<string, unknown>,
  ) {
    const { error } = await this.supabase
      .from('scanner_actions')
      .update({
        status: 'success',
        result_summary: resultSummary,
        executed_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('tenant_id', tenantId);
    if (error) throw error;
  }

  async markFailed(id: string, tenantId: string, errorMessage: string) {
    const { error } = await this.supabase
      .from('scanner_actions')
      .update({
        status: 'failed',
        error_message: errorMessage,
        executed_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('tenant_id', tenantId);
    if (error) throw error;
  }

  async findByEvent(tenantId: string, eventId: string) {
    const { data, error } = await this.supabase
      .from('scanner_actions')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('event_id', eventId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data;
  }
}
