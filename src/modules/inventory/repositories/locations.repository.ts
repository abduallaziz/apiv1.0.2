import { Injectable } from '@nestjs/common';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';
import { SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class LocationsRepository extends ScopedRepository {
  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  async findAll(warehouseId: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('warehouse_locations')
      .select('*')
      .eq('warehouse_id', warehouseId)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .order('code');
    if (error) throw error;
    return data;
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
