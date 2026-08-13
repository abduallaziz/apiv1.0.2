import { Injectable } from '@nestjs/common';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';
import { SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class CorrectiveActionsRepository extends ScopedRepository {
  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  async findAll(tenantId: string, ownerId?: string, status?: string) {
    let query = this.supabase.from('corrective_actions').select('*').eq('tenant_id', tenantId);
    if (ownerId) query = query.eq('owner_id', ownerId);
    if (status) query = query.eq('status', status);
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  }

  async findById(id: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('corrective_actions')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async create(tenantId: string, payload: Record<string, unknown>) {
    const { data, error } = await this.supabase
      .from('corrective_actions')
      .insert({ ...payload, tenant_id: tenantId, status: 'assigned' })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async updateStatus(id: string, tenantId: string, fromStatus: string, payload: Record<string, unknown>) {
    const { data, error } = await this.supabase
      .from('corrective_actions')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .eq('status', fromStatus)
      .select()
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async recordHistory(tenantId: string, actionId: string, oldStatus: string | null, newStatus: string, actorId: string, notes?: string) {
    const { error } = await this.supabase.from('corrective_action_history').insert({
      tenant_id: tenantId,
      corrective_action_id: actionId,
      old_status: oldStatus,
      new_status: newStatus,
      actor_id: actorId,
      notes: notes ?? null,
    });
    if (error) throw error;
  }

  async findHistory(tenantId: string, actionId: string) {
    const { data, error } = await this.supabase
      .from('corrective_action_history')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('corrective_action_id', actionId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  }
}
