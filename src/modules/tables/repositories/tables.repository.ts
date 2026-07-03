import { ConflictException, Injectable, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../../shared/supabase/supabase.module';

const SELECT = 'id, branch_id, name, capacity, status, created_at';

interface PostgrestError {
  code?: string;
  message?: string;
}

function isPostgrestError(error: unknown): error is PostgrestError {
  return typeof error === 'object' && error !== null && 'code' in error;
}

function toHttpError(error: unknown): unknown {
  if (!isPostgrestError(error)) return error;
  if (error.code === '23505') {
    return new ConflictException('A table with this name already exists at this branch');
  }
  return error;
}

@Injectable()
export class TablesRepository {
  constructor(@Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient) {}

  async findAll(tenantId: string, branchId?: string) {
    let q = this.supabase
      .from('tables')
      .select(SELECT)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .order('name', { ascending: true });
    if (branchId) q = q.eq('branch_id', branchId);
    const { data, error } = await q;
    if (error) throw error;
    return data;
  }

  async findById(id: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('tables')
      .select(SELECT)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async branchBelongsToTenant(branchId: string, tenantId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('branches')
      .select('id')
      .eq('id', branchId)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw error;
    return !!data;
  }

  async create(tenantId: string, dto: { branch_id: string; name: string; capacity?: number }) {
    const { data, error } = await this.supabase
      .from('tables')
      .insert({ tenant_id: tenantId, ...dto })
      .select(SELECT)
      .single();
    if (error) throw toHttpError(error);
    return data;
  }

  async update(id: string, tenantId: string, dto: object) {
    const { data, error } = await this.supabase
      .from('tables')
      .update(dto)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select(SELECT)
      .single();
    if (error) throw toHttpError(error);
    return data;
  }

  async softDelete(id: string, tenantId: string) {
    const { error } = await this.supabase
      .from('tables')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenantId);
    if (error) throw error;
  }
}
