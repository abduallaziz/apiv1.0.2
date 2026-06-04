import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';
import { ScopedRepository } from '../../core/tenant/scoped.repository';
import { TenantContext } from '../../core/tenant/tenant-context';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@Injectable()
export class CustomersRepository extends ScopedRepository {
  constructor(@Inject(SUPABASE_CLIENT) supabase: SupabaseClient) {
    super(supabase);
  }

  async findAll(tenant: TenantContext, search?: string, page = 1, limit = 20) {
    let query = this.scopedQuery('customers', tenant)
      .select('id, full_name, phone, email, loyalty_points, is_active, created_at')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    if (search) {
      query = query.or(`full_name.ilike.%${search}%,phone.ilike.%${search}%`);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data;
  }

  async findById(tenant: TenantContext, id: string) {
    const { data, error } = await this.scopedQuery('customers', tenant)
      .select('*')
      .eq('id', id)
      .is('deleted_at', null)
      .single();
    if (error) throw error;
    return data;
  }

  async findByPhone(tenant: TenantContext, phone: string) {
    const { data } = await this.scopedQuery('customers', tenant)
      .select('id')
      .eq('phone', phone)
      .is('deleted_at', null)
      .maybeSingle();
    return data;
  }

  async create(tenant: TenantContext, payload: CreateCustomerDto) {
    const { data, error } = await this.supabase
      .from('customers')
      .insert({
        ...payload,
        tenant_id: tenant.tenantId,
        loyalty_points: 0,
        is_active: true,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async update(tenant: TenantContext, id: string, payload: UpdateCustomerDto) {
    const { data, error } = await this.supabase
      .from('customers')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenant.tenantId)
      .is('deleted_at', null)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async softDelete(tenant: TenantContext, id: string) {
    const { error } = await this.supabase
      .from('customers')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenant.tenantId);
    if (error) throw error;
  }

  async getGlobalStats(tenant: TenantContext) {
  let query = this.supabase
    .from('customers')
    .select('id, created_at')
    .is('deleted_at', null);

  if (tenant.tenantId) {
    query = query.eq('tenant_id', tenant.tenantId);
  }

  const { data, error } = await query;
  if (error) throw error;

  const all = data ?? [];
  const now = new Date();
  const newThisMonth = all.filter(c => {
    const d = new Date(c.created_at);
    return (
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear()
    );
  });

  return {
    total: all.length,
    new_this_month: newThisMonth.length,
  };
}

  async getHistory(tenant: TenantContext, customerId: string, limit = 10) {
    const { data, error } = await this.supabase
      .from('orders')
      .select('id, total, payment_method, status, created_at')
      .eq('tenant_id', tenant.tenantId)
      .eq('customer_id', customerId)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data ?? [];
  }

  async getStats(tenant: TenantContext, customerId: string) {
    const { data, error } = await this.supabase
      .from('orders')
      .select('total, created_at')
      .eq('tenant_id', tenant.tenantId)
      .eq('customer_id', customerId)
      .eq('status', 'completed');
    if (error) throw error;

    const orders = data ?? [];
    const orders_count = orders.length;
    const total_spent = orders.reduce((sum, o) => sum + (o.total ?? 0), 0);
    const avg_order = orders_count > 0 ? Math.round(total_spent / orders_count) : 0;
    const last_order_at = orders_count > 0
      ? orders.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0].created_at
      : null;

    return { orders_count, total_spent, avg_order, last_order_at };
  }
}