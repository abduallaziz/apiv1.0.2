import { Injectable, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { TenantContext } from '../../core/tenant/tenant.context';
import {
  branchForWrite,
  scopeToBranch,
} from '../../core/tenant/branch-scope.util';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';

@Injectable()
export class ExpenseTemplatesService {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async findAll(tenantId: string, tenant?: TenantContext) {
    let q = this.supabase
      .from('expense_templates')
      .select('*')
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .order('name');
    if (tenant) q = scopeToBranch(q, tenant);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async create(
    tenantId: string,
    dto: {
      name: string;
      default_amount?: number | null;
      expiry_hours?: number;
      requires_photo?: boolean;
    },
    tenant?: TenantContext,
  ) {
    const { data, error } = await this.supabase
      .from('expense_templates')
      .insert({
        ...(tenant?.isolated ? { branch_id: branchForWrite(tenant) } : {}),
        tenant_id: tenantId,
        name: dto.name,
        default_amount: dto.default_amount ?? null,
        expiry_hours: dto.expiry_hours ?? 24,
        requires_photo: dto.requires_photo ?? false,
        is_active: true,
        is_pre_approved: false,
        recurrence_type: 'none',
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async update(
    id: string,
    tenantId: string,
    dto: {
      name?: string;
      default_amount?: number | null;
      requires_photo?: boolean;
      expiry_hours?: number;
      is_active?: boolean;
      is_pre_approved?: boolean;
      recurrence_type?: string;
      recurrence_day?: number | null;
      next_run_at?: string | null;
    },
    tenant?: TenantContext,
  ) {
    let q = this.supabase
      .from('expense_templates')
      .update({ ...dto, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenantId);
    if (tenant) q = scopeToBranch(q, tenant);
    const { data, error } = await q.select().single();
    if (error) throw new Error(error.message);
    return data;
  }

  async remove(id: string, tenantId: string, tenant?: TenantContext) {
    let q = this.supabase
      .from('expense_templates')
      .update({ deleted_at: new Date().toISOString(), is_active: false })
      .eq('id', id)
      .eq('tenant_id', tenantId);
    if (tenant) q = scopeToBranch(q, tenant);
    const { error } = await q;
    if (error) throw new Error(error.message);
  }
}
