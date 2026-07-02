import { Injectable, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';
import { ScopedRepository } from '../../core/tenant/scoped.repository';
import { TenantContext } from '../../core/tenant/tenant.context';

@Injectable()
export class UsersRepository extends ScopedRepository {
  constructor(@Inject(SUPABASE_CLIENT) supabase: SupabaseClient) {
    super(supabase);
  }

  async findAll(tenant: TenantContext) {
    return this.scopedQuery('users', tenant)
      .select('id, email, name, role, is_active, created_at')
      .order('created_at', { ascending: false });
  }

  async findById(id: string, tenant: TenantContext) {
    return this.scopedQuery('users', tenant)
      .select('id, email, name, role, is_active, created_at')
      .eq('id', id)
      .single();
  }

  async findByEmail(email: string, tenantId: string) {
    return this.supabase
      .from('users')
      .select('id, email, name, role, is_active')
      .eq('email', email)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .single();
  }

  async countActive(tenant: TenantContext) {
    return this.supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenant.tenantId)
      .is('deleted_at', null);
  }

  async create(data: Record<string, any>) {
    return this.supabase
      .from('users')
      .insert(data)
      .select('id, email, name, role, is_active, created_at')
      .single();
  }

  async update(id: string, tenantId: string, data: Record<string, any>) {
    return this.supabase
      .from('users')
      .update(data)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select('id, email, name, role, is_active')
      .single();
  }

  async softDelete(id: string, tenantId: string) {
    return this.supabase
      .from('users')
      .update({ deleted_at: new Date().toISOString(), is_active: false })
      .eq('id', id)
      .eq('tenant_id', tenantId);
  }
}