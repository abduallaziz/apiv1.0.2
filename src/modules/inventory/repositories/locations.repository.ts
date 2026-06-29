import { Injectable } from '@nestjs/common';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';
import { SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class LocationsRepository extends ScopedRepository {
  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  async findAll(
    warehouseId: string,
    tenantId: string,
    options: { search?: string; page?: number; limit?: number } = {},
  ) {
    const page = options.page && options.page > 0 ? options.page : 1;
    const limit = options.limit && options.limit > 0 ? options.limit : 20;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = this.supabase
      .from('warehouse_locations')
      .select('*', { count: 'exact' })
      .eq('warehouse_id', warehouseId)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null);

    if (options.search) {
      const term = options.search.replace(/[%,]/g, '');
      query = query.or(`code.ilike.%${term}%,name.ilike.%${term}%`);
    }

    const { data, error, count } = await query.order('code').range(from, to);
    if (error) throw error;
    return { data, total: count ?? 0, page, limit };
  }

  async findById(id: string, warehouseId: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('warehouse_locations')
      .select('*')
      .eq('id', id)
      .eq('warehouse_id', warehouseId)
      .eq('tenant_id', tenantId)
      .single();
    if (error) throw error;
    return data;
  }

  async create(warehouseId: string, tenantId: string, payload: Record<string, unknown>) {
    const { data, error } = await this.supabase
      .from('warehouse_locations')
      .insert({ ...payload, warehouse_id: warehouseId, tenant_id: tenantId, is_active: payload.is_active ?? true })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async update(id: string, warehouseId: string, tenantId: string, payload: Record<string, unknown>) {
    const { data, error } = await this.supabase
      .from('warehouse_locations')
      .update(payload)
      .eq('id', id)
      .eq('warehouse_id', warehouseId)
      .eq('tenant_id', tenantId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async softDelete(id: string, warehouseId: string, tenantId: string) {
    const { error } = await this.supabase
      .from('warehouse_locations')
      .update({ deleted_at: new Date().toISOString(), is_active: false })
      .eq('id', id)
      .eq('warehouse_id', warehouseId)
      .eq('tenant_id', tenantId);
    if (error) throw error;
  }
}
