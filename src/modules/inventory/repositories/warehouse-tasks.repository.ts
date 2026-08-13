import { Injectable } from '@nestjs/common';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';
import { SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class WarehouseTasksRepository extends ScopedRepository {
  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  async findAll(tenantId: string, taskType?: string, status?: string, assignedTo?: string) {
    let query = this.supabase.from('warehouse_tasks').select('*, items(name), warehouses(name)').eq('tenant_id', tenantId);
    if (taskType) query = query.eq('task_type', taskType);
    if (status) query = query.eq('status', status);
    if (assignedTo) query = query.eq('assigned_to', assignedTo);
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  }

  async findById(id: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('warehouse_tasks')
      .select('*, items(name)')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async findHistory(tenantId: string, taskId: string) {
    const { data, error } = await this.supabase
      .from('warehouse_task_history')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('task_id', taskId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  }

  async createManual(tenantId: string, payload: Record<string, unknown>) {
    const { data, error } = await this.supabase
      .from('warehouse_tasks')
      .insert({ ...payload, tenant_id: tenantId, status: 'pending' })
      .select()
      .single();
    if (error) throw error;
    await this.supabase.from('warehouse_task_history').insert({
      tenant_id: tenantId, task_id: data.id, old_status: null, new_status: 'pending', actor_id: payload.created_by,
    });
    return data;
  }

  async assign(taskId: string, tenantId: string, assignedTo: string, actorId: string) {
    const { data, error } = await this.supabase.rpc('fn_assign_warehouse_task', {
      p_task_id: taskId, p_tenant_id: tenantId, p_assigned_to: assignedTo, p_actor_id: actorId,
    });
    if (error) throw error;
    return data;
  }

  async confirm(taskId: string, tenantId: string, quantity: number, confirmedLocationId: string, actorId: string) {
    const { data, error } = await this.supabase.rpc('fn_confirm_warehouse_task', {
      p_task_id: taskId, p_tenant_id: tenantId, p_quantity: quantity, p_confirmed_location_id: confirmedLocationId, p_actor_id: actorId,
    });
    if (error) throw error;
    return data;
  }

  async cancel(taskId: string, tenantId: string, actorId: string) {
    const { data, error } = await this.supabase.rpc('fn_cancel_warehouse_task', {
      p_task_id: taskId, p_tenant_id: tenantId, p_actor_id: actorId,
    });
    if (error) throw error;
    return data;
  }
}
