import { Injectable } from '@nestjs/common';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';
import { SupabaseClient } from '@supabase/supabase-js';
import { TenantContext } from '../../../core/tenant/tenant.context';

@Injectable()
export class InspectionsRepository extends ScopedRepository {
  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  private ctx(tenantId: string): TenantContext {
    return { tenantId } as TenantContext;
  }

  async findAll(tenantId: string) {
    const { data, error } = await this.supabase
      .from('quality_inspections')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  }

  async findById(id: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('quality_inspections')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async create(tenantId: string, payload: Record<string, unknown>) {
    const { data, error } = await this.supabase
      .from('quality_inspections')
      .insert({ ...payload, tenant_id: tenantId, status: 'pending' })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async complete(
    id: string,
    tenantId: string,
    payload: Record<string, unknown>,
  ) {
    const { data, error } = await this.supabase
      .from('quality_inspections')
      .update({ ...payload, inspected_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .eq('status', 'pending')
      .select()
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async addResults(
    tenantId: string,
    inspectionId: string,
    results: Record<string, unknown>[],
  ) {
    if (results.length === 0) return [];
    const { data, error } = await this.supabase
      .from('quality_results')
      .insert(
        results.map((r) => ({
          ...r,
          tenant_id: tenantId,
          quality_inspection_id: inspectionId,
        })),
      )
      .select();
    if (error) throw error;
    return data;
  }

  async getResults(tenantId: string, inspectionId: string) {
    const { data, error } = await this.supabase
      .from('quality_results')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('quality_inspection_id', inspectionId);
    if (error) throw error;
    return data;
  }
}
