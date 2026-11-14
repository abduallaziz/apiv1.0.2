import { Injectable } from '@nestjs/common';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';
import { SupabaseClient } from '@supabase/supabase-js';
import { TenantContext } from '../../../core/tenant/tenant.context';
import {
  branchStamp,
  withBranch,
} from '../../../core/tenant/branch-scope-id.util';

@Injectable()
export class UnitsRepository extends ScopedRepository {
  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  /** Select builder scoped to the tenant and (under isolation) to the branch. */
  private scoped(table: string, tenantId: string, branchId?: string | null) {
    return withBranch(this.scopedQuery(table, this.ctx(tenantId)), branchId);
  }

  private ctx(tenantId: string): TenantContext {
    return { tenantId } as TenantContext;
  }

  async findAll(tenantId: string, branchId?: string | null) {
    const { data, error } = await this.scoped('units', tenantId, branchId)
      .select('id, name, symbol, is_active, created_at')
      .eq('is_active', true)
      .order('name');
    if (error) throw error;
    return data;
  }

  async findById(id: string, tenantId: string, branchId?: string | null) {
    const { data, error } = await this.scoped('units', tenantId, branchId)
      .select('id, name, symbol, is_active, created_at')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async create(
    tenantId: string,
    payload: Record<string, unknown>,
    branchId?: string | null,
  ) {
    const { data, error } = await this.supabase
      .from('units')
      .insert({
        ...payload,
        tenant_id: tenantId,
        ...branchStamp(branchId),
        is_active: true,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async update(id: string, tenantId: string, payload: Record<string, unknown>) {
    const { data, error } = await this.supabase
      .from('units')
      .update(payload)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async softDelete(id: string, tenantId: string) {
    const { error } = await this.supabase
      .from('units')
      .update({ is_active: false })
      .eq('id', id)
      .eq('tenant_id', tenantId);
    if (error) throw error;
  }
}
