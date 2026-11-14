import { Injectable, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { TenantContext } from '../../core/tenant/tenant.context';
import {
  branchForWrite,
  scopeToBranch,
} from '../../core/tenant/branch-scope.util';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';

@Injectable()
export class ExpenseCategoriesService {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async findAll(tenantId: string, tenant?: TenantContext) {
    let q = this.supabase
      .from('expense_categories')
      .select('id, name, is_active, created_at')
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .order('name');
    if (tenant) q = scopeToBranch(q, tenant);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async create(tenantId: string, name: string, tenant?: TenantContext) {
    const { data, error } = await this.supabase
      .from('expense_categories')
      .insert({
        tenant_id: tenantId,
        name,
        is_active: true,
        ...(tenant?.isolated ? { branch_id: branchForWrite(tenant) } : {}),
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async update(
    id: string,
    tenantId: string,
    dto: { name?: string; is_active?: boolean },
    tenant?: TenantContext,
  ) {
    let q = this.supabase
      .from('expense_categories')
      .update(dto)
      .eq('id', id)
      .eq('tenant_id', tenantId);
    if (tenant) q = scopeToBranch(q, tenant);
    const { data, error } = await q.select().single();
    if (error) throw new Error(error.message);
    return data;
  }

  async remove(id: string, tenantId: string, tenant?: TenantContext) {
    let q = this.supabase
      .from('expense_categories')
      .update({ deleted_at: new Date().toISOString(), is_active: false })
      .eq('id', id)
      .eq('tenant_id', tenantId);
    if (tenant) q = scopeToBranch(q, tenant);
    const { error } = await q;
    if (error) throw new Error(error.message);
  }
}
