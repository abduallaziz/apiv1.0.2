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

  async findAll(
    tenant: TenantContext,
    search?: string,
    page = 1,
    limit = 20,
    customFieldKeys: string[] = [],
  ) {
    let query = this.scopedQuery('customers', tenant)
      .select('id, full_name, phone, email, plate_number, visit_date, odometer, loyalty_points, is_active, custom_fields, created_at')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    if (search) {
      const escaped = search.replace(/[%,]/g, '');
      const conditions = [
        `full_name.ilike.%${escaped}%`,
        `phone.ilike.%${escaped}%`,
        ...customFieldKeys.map((key) => `custom_fields->>${key}.ilike.%${escaped}%`),
      ];
      query = query.or(conditions.join(','));
    }

    const { data, error } = await query;
    if (error) throw error;

    const customers = data ?? [];
    if (customers.length === 0) return customers;

    const ids = customers.map((c) => c.id);
    const { data: orders, error: ordersError } = await this.supabase
      .from('orders')
      .select('customer_id, total')
      .eq('tenant_id', tenant.tenantId)
      .eq('status', 'completed')
      .in('customer_id', ids);
    if (ordersError) throw ordersError;

    const statsByCustomer = new Map<string, { orders_count: number; total_spent: number }>();
    for (const order of orders ?? []) {
      const entry = statsByCustomer.get(order.customer_id) ?? { orders_count: 0, total_spent: 0 };
      entry.orders_count += 1;
      entry.total_spent += order.total ?? 0;
      statsByCustomer.set(order.customer_id, entry);
    }

    return customers.map((customer) => ({
      ...customer,
      orders_count: statsByCustomer.get(customer.id)?.orders_count ?? 0,
      total_spent: statsByCustomer.get(customer.id)?.total_spent ?? 0,
    }));
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

  async countAll(tenant: TenantContext): Promise<number> {
    const { count, error } = await this.supabase
      .from('customers')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant.tenantId);
    if (error) throw error;
    return count ?? 0;
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
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    let totalQuery = this.supabase
      .from('customers')
      .select('id', { count: 'exact', head: true })
      .is('deleted_at', null);

    let monthQuery = this.supabase
      .from('customers')
      .select('id', { count: 'exact', head: true })
      .is('deleted_at', null)
      .gte('created_at', startOfMonth);

    // tenantId is null only for superadmin callers — intentional cross-tenant access
    if (tenant.tenantId) {
      totalQuery = totalQuery.eq('tenant_id', tenant.tenantId);
      monthQuery = monthQuery.eq('tenant_id', tenant.tenantId);
    }

    const [{ count: total, error: e1 }, { count: newThisMonth, error: e2 }] = await Promise.all([
      totalQuery,
      monthQuery,
    ]);

    if (e1) throw e1;
    if (e2) throw e2;

    return {
      total: total ?? 0,
      new_this_month: newThisMonth ?? 0,
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
    const [countRes, aggRes, lastRes] = await Promise.all([
      this.supabase
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenant.tenantId)
        .eq('customer_id', customerId)
        .eq('status', 'completed'),
      this.supabase.rpc('customer_order_aggregates', {
        p_tenant_id: tenant.tenantId,
        p_customer_id: customerId,
      }),
      this.supabase
        .from('orders')
        .select('created_at')
        .eq('tenant_id', tenant.tenantId)
        .eq('customer_id', customerId)
        .eq('status', 'completed')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (countRes.error) throw countRes.error;

    const orders_count = countRes.count ?? 0;
    const total_spent = Number(aggRes.data?.total_spent ?? 0);
    const avg_order = orders_count > 0 ? Math.round(total_spent / orders_count) : 0;
    const last_order_at = (lastRes.data as any)?.created_at ?? null;

    return { orders_count, total_spent, avg_order, last_order_at };
  }
}