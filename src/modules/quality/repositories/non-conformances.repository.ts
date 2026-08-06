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

  async close(id: string, tenantId: string, resolvedBy: string) {
    const { data, error } = await this.supabase
      .from('non_conformances')
      .update({ status: 'closed', resolved_by: resolvedBy, resolved_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .eq('status', 'open')
      .select()
      .maybeSingle();
    if (error) throw error;
    return data;
  }
}
