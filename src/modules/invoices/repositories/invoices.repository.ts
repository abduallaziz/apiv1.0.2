import { Injectable, Inject } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../../../shared/supabase/supabase.module';
import { SupabaseClient } from '@supabase/supabase-js';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';
import { TenantContext } from '../../../core/tenant/tenant-context';

@Injectable()
export class InvoicesRepository extends ScopedRepository {
  constructor(@Inject(SUPABASE_CLIENT) supabase: SupabaseClient) {
    super(supabase);
  }

  private ordersQuery(tenant: TenantContext) {
    const query = this.supabase.from('orders').select('*');
    if (tenant.tenantId) {
      return query.eq('tenant_id', tenant.tenantId);
    }
    return query;
  }

  async findAll(tenant: TenantContext, branchId?: string) {
    let query = this.ordersQuery(tenant).select(
      `id, status, subtotal, discount, tax, total,
       payment_method, notes, created_at,
       cashier_id, customer_id, branch_id`,
    );

    if (branchId) {
      query = query.eq('branch_id', branchId);
    }

    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  }

  async findById(tenant: TenantContext, id: string) {
    const { data, error } = await this.ordersQuery(tenant)
      .select(
        `id, status, subtotal, discount, tax, total,
         payment_method, notes, created_at,
         cashier_id, customer_id, branch_id`,
      )
      .eq('id', id)
      .single();

    if (error) throw error;
    return data;
  }

  async create(tenant: TenantContext, payload: Record<string, unknown>) {
    const { data, error } = await this.supabase
      .from('orders')
      .insert({ ...payload, tenant_id: tenant.tenantId })
      .select('id')
      .single();

    if (error) throw error;
    return data;
  }

  async insertItems(items: Record<string, unknown>[]) {
    const mapped = items.map((item) => ({
      order_id: item.order_id,
      item_id: item.item_id,
      item_name: item.item_name,
      qty: item.quantity,
      price: item.unit_price,
    }));

    const { error } = await this.supabase.from('order_items').insert(mapped);
    if (error) throw error;
  }

  async cancel(tenant: TenantContext, id: string, cancelledBy: string) {
    const query = this.supabase
      .from('orders')
      .update({ status: 'cancelled' })
      .eq('id', id);

    if (tenant.tenantId) {
      const { data, error } = await query
        .eq('tenant_id', tenant.tenantId)
        .select('id, status')
        .single();
      if (error) throw error;
      return data;
    }

    const { data, error } = await query.select('id, status').single();
    if (error) throw error;
    return data;
  }
}