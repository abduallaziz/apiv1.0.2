import { Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';

@Injectable()
export class DevicesRepository extends ScopedRepository {
  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  async findAll(tenantId: string) {
    const { data, error } = await this.supabase
      .from('scanner_devices')
      .select('*, scanner_device_capabilities(capability)')
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  }

  async findById(id: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('scanner_devices')
      .select('*, scanner_device_capabilities(capability)')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async create(
    tenantId: string,
    payload: {
      device_code: string;
      name: string;
      device_type: string;
      assigned_to?: string;
      assigned_warehouse_id?: string;
      created_by?: string;
    },
  ) {
    const { data, error } = await this.supabase
      .from('scanner_devices')
      .insert({ tenant_id: tenantId, ...payload })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async setCapabilities(
    tenantId: string,
    deviceId: string,
    capabilities: string[],
  ) {
    await this.supabase
      .from('scanner_device_capabilities')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('device_id', deviceId);

    if (capabilities.length === 0) return;

    const { error } = await this.supabase
      .from('scanner_device_capabilities')
      .insert(
        capabilities.map((capability) => ({
          tenant_id: tenantId,
          device_id: deviceId,
          capability,
        })),
      );
    if (error) throw error;
  }

  async update(
    id: string,
    tenantId: string,
    payload: Partial<{
      name: string;
      status: string;
      assigned_to: string | null;
      assigned_warehouse_id: string | null;
    }>,
  ) {
    const { data, error } = await this.supabase
      .from('scanner_devices')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async touchLastSeen(id: string, tenantId: string, healthStatus: string) {
    const { error } = await this.supabase
      .from('scanner_devices')
      .update({
        last_seen_at: new Date().toISOString(),
        health_status: healthStatus,
      })
      .eq('id', id)
      .eq('tenant_id', tenantId);
    if (error) throw error;
  }

  async softDelete(id: string, tenantId: string) {
    const { error } = await this.supabase
      .from('scanner_devices')
      .update({ deleted_at: new Date().toISOString(), status: 'disabled' })
      .eq('id', id)
      .eq('tenant_id', tenantId);
    if (error) throw error;
  }
}
