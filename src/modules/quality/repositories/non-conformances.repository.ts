import { Injectable } from '@nestjs/common';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';
import { SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class NonConformancesRepository extends ScopedRepository {
  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  async findAll(tenantId: string) {
    const { data, error } = await this.supabase
      .from('non_conformances')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  }

  async findById(id: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('non_conformances')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async create(tenantId: string, payload: Record<string, unknown>) {
    const { data, error } = await this.supabase
      .from('non_conformances')
      .insert({ ...payload, tenant_id: tenantId, status: 'open' })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  // Generic lifecycle transition: open -> investigating -> containment ->
  // corrective_action -> verification -> closed. fromStatus guards against
  // a stale-read race (same pattern as the original close()).
  async updateStatus(
    id: string,
    tenantId: string,
    fromStatus: string,
    payload: Record<string, unknown>,
  ) {
    const { data, error } = await this.supabase
      .from('non_conformances')
      .update(payload)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .eq('status', fromStatus)
      .select()
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async addDefect(tenantId: string, ncId: string, payload: Record<string, unknown>) {
    const { data, error } = await this.supabase
      .from('quality_defects')
      .insert({ ...payload, tenant_id: tenantId, non_conformance_id: ncId })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async findDefects(tenantId: string, ncId: string) {
    const { data, error } = await this.supabase
      .from('quality_defects')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('non_conformance_id', ncId);
    if (error) throw error;
    return data;
  }

  async recordStatusHistory(tenantId: string, ncId: string, oldStatus: string | null, newStatus: string, actorId: string, reason?: string) {
    const { error } = await this.supabase.from('quality_status_history').insert({
      tenant_id: tenantId,
      reference_type: 'non_conformance',
      reference_id: ncId,
      old_status: oldStatus,
      new_status: newStatus,
      actor_id: actorId,
      reason: reason ?? null,
    });
    if (error) throw error;
  }
}
