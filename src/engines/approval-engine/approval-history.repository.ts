import { Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';

// The one shared audit trail for every approval-driven entity in Sefay —
// purchase requests today, RFQs/purchase orders/expenses/sales/inventory/
// returns later — all writing to the same table via reference_type/
// reference_id, never their own bespoke history table.
@Injectable()
export class ApprovalHistoryRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async record(entry: {
    tenantId: string;
    referenceType: string;
    referenceId: string;
    action: string;
    actorId: string | null;
    previousStatus: string | null;
    newStatus: string | null;
    reason?: string;
  }) {
    const { error } = await this.supabase.from('approval_history').insert({
      tenant_id: entry.tenantId,
      reference_type: entry.referenceType,
      reference_id: entry.referenceId,
      action: entry.action,
      actor_id: entry.actorId,
      previous_status: entry.previousStatus,
      new_status: entry.newStatus,
      reason: entry.reason ?? null,
    });
    if (error) throw error;
  }

  async findForReference(
    tenantId: string,
    referenceType: string,
    referenceId: string,
  ) {
    const { data, error } = await this.supabase
      .from('approval_history')
      .select('*, actor:users!actor_id(id, name)')
      .eq('tenant_id', tenantId)
      .eq('reference_type', referenceType)
      .eq('reference_id', referenceId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data;
  }
}
