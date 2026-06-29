import { ConflictException, Injectable, BadRequestException } from '@nestjs/common';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';
import { SupabaseClient } from '@supabase/supabase-js';
import { TenantContext } from '../../../core/tenant/tenant.context';

interface PostgrestError {
  code?: string;
  message?: string;
  details?: string;
}

function isPostgrestError(error: unknown): error is PostgrestError {
  return typeof error === 'object' && error !== null && 'code' in error;
}

// Translates known Postgres constraint violations into actionable HTTP errors
// instead of letting them fall through to the generic 500 handler.
function toHttpError(error: unknown): unknown {
  if (!isPostgrestError(error)) return error;

  if (error.code === '23505') {
    return new ConflictException('A warehouse with this code already exists');
  }
  if (error.code === '23503') {
    return new BadRequestException('The selected branch does not exist');
  }
  return error;
}

@Injectable()
export class WarehousesRepository extends ScopedRepository {
  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  private ctx(tenantId: string): TenantContext {
    return { tenantId } as TenantContext;
  }

  async findAll(tenantId: string) {
    const { data, error } = await this.scopedQuery('warehouses', this.ctx(tenantId)).order('name');
    if (error) throw error;
    return data;
  }

  async findById(id: string, tenantId: string) {
    const { data, error } = await this.scopedQuery('warehouses', this.ctx(tenantId))
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  }

  async create(tenantId: string, payload: Record<string, unknown>) {
    const { data, error } = await this.supabase
      .from('warehouses')
      .insert({ ...payload, tenant_id: tenantId, is_active: payload.is_active ?? true })
      .select()
      .single();
    if (error) throw toHttpError(error);
    return data;
  }

  async update(id: string, tenantId: string, payload: Record<string, unknown>) {
    const { data, error } = await this.supabase
      .from('warehouses')
      .update(payload)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single();
    if (error) throw toHttpError(error);
    return data;
  }

  async softDelete(id: string, tenantId: string) {
    const { error } = await this.supabase
      .from('warehouses')
      .update({ deleted_at: new Date().toISOString(), is_active: false })
      .eq('id', id)
      .eq('tenant_id', tenantId);
    if (error) throw error;
  }
}
