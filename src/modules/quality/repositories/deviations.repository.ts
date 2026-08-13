import { Injectable } from '@nestjs/common';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';
import { SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class DeviationsRepository extends ScopedRepository {
  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  async findAll(tenantId: string) {
    const { data, error } = await this.supabase
      .from('quality_deviations')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  }

  async findById(id: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('quality_deviations')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async create(tenantId: string, payload: Record<string, unknown>) {
    const { data, error } = await this.supabase
      .from('quality_deviations')
      .insert({ ...payload, tenant_id: tenantId, status: 'pending' })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async decide(
    id: string,
    tenantId: string,
    status: 'approved' | 'rejected',
    approverId: string,
    notes?: string,
  ) {
    const { data, error } = await this.supabase
      .from('quality_deviations')
      .update({
        status,
        approver_id: approverId,
        decision_notes: notes ?? null,
        decided_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .eq('status', 'pending')
      .select()
      .maybeSingle();
    if (error) throw error;
    return data;
  }
}
