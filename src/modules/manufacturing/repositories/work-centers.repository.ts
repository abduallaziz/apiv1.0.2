import { BadRequestException, Injectable } from '@nestjs/common';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';
import { SupabaseClient } from '@supabase/supabase-js';
import { TenantContext } from '../../../core/tenant/tenant.context';

interface PostgrestError {
  code?: string;
}

function isPostgrestError(error: unknown): error is PostgrestError {
  return typeof error === 'object' && error !== null && 'code' in error;
}

function toHttpError(error: unknown): unknown {
  if (isPostgrestError(error) && error.code === '23503') {
    return new BadRequestException('The selected warehouse does not exist');
  }
  return error;
}

@Injectable()
export class WorkCentersRepository extends ScopedRepository {
  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  private ctx(tenantId: string): TenantContext {
    return { tenantId } as TenantContext;
  }

  async findAll(tenantId: string) {
    const { data, error } = await this.scopedQuery(
      'work_centers',
      this.ctx(tenantId),
    ).order('name');
    if (error) throw error;
    return data;
  }

  async findById(id: string, tenantId: string) {
    const { data, error } = await this.scopedQuery(
      'work_centers',
      this.ctx(tenantId),
    )
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async create(tenantId: string, payload: Record<string, unknown>) {
    const { data, error } = await this.supabase
      .from('work_centers')
      .insert({
        ...payload,
        tenant_id: tenantId,
        is_active: payload.is_active ?? true,
      })
      .select()
      .single();
    if (error) throw toHttpError(error);
    return data;
  }

  async update(id: string, tenantId: string, payload: Record<string, unknown>) {
    const { data, error } = await this.supabase
      .from('work_centers')
      .update(payload)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single();
    if (error) throw toHttpError(error);
    return data;
  }

  async setActive(id: string, tenantId: string, isActive: boolean) {
    const { data, error } = await this.supabase
      .from('work_centers')
      .update({ is_active: isActive })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }
}
