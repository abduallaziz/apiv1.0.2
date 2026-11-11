import { Injectable } from '@nestjs/common';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';
import { SupabaseClient } from '@supabase/supabase-js';
import {
  WarehouseTasksQueryDto,
  PagedResult,
} from '../dto/wms-list-query.dto';

@Injectable()
export class WarehouseTasksRepository extends ScopedRepository {
  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  async findAll(
    tenantId: string,
    taskType?: string,
    status?: string,
    assignedTo?: string,
  ): Promise<unknown[]>;
  async findAll(
    tenantId: string,
    query: WarehouseTasksQueryDto,
  ): Promise<unknown[] | PagedResult<unknown>>;
  async findAll(
    tenantId: string,
    arg2?: string | WarehouseTasksQueryDto,
    arg3?: string,
    arg4?: string,
  ) {
    let q: WarehouseTasksQueryDto;
    if (typeof arg2 === 'object') {
      q = arg2;
    } else {
      q = { task_type: arg2, status: arg3, assigned_to: arg4 };
    }

    const applyFilters = (query: any) => {
      if (q.task_type) query = query.eq('task_type', q.task_type);
      if (q.status) query = query.eq('status', q.status);
      if (q.assigned_to) query = query.eq('assigned_to', q.assigned_to);
      if (q.warehouse_id) query = query.eq('warehouse_id', q.warehouse_id);
      return query;
    };

    if (!q.page) {
      let query = this.supabase
        .from('warehouse_tasks')
        .select('*, items(name), warehouses(name)')
        .eq('tenant_id', tenantId);
      query = applyFilters(query);
      const { data, error } = await query.order('created_at', {
        ascending: false,
      });
      if (error) throw error;
      return data;
    }

    const page = q.page;
    const limit = q.limit ?? 20;
    const sortBy = q.sortBy ?? 'created_at';
    const sortOrder = q.sortOrder ?? 'desc';

    let dataQuery = this.supabase
      .from('warehouse_tasks')
      .select('*, items(name), warehouses(name)')
      .eq('tenant_id', tenantId);
    dataQuery = applyFilters(dataQuery);
    dataQuery = dataQuery
      .order(sortBy, { ascending: sortOrder === 'asc' })
      .order('id', { ascending: true })
      .range((page - 1) * limit, page * limit - 1);

    let countQuery = this.supabase
      .from('warehouse_tasks')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId);
    countQuery = applyFilters(countQuery);

    const [{ data, error }, { count, error: countError }] = await Promise.all(
      [dataQuery, countQuery],
    );
    if (error) throw error;
    if (countError) throw countError;
    return {
      data,
      total: count ?? 0,
      page,
      perPage: limit,
    } as PagedResult<unknown>;
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

  // Inventory #7 / 7-1 (Owner-approved) — reads from the shared,
  // entity-typed warehouse_work_status_history now, not the legacy
  // warehouse_task_history (which no longer receives new rows as of
  // migration 223).
  async findHistory(tenantId: string, taskId: string) {
    const { data, error } = await this.supabase
      .from('warehouse_work_status_history')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('entity_type', 'warehouse_task')
      .eq('entity_id', taskId)
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
    await this.supabase.from('warehouse_work_status_history').insert({
      tenant_id: tenantId,
      entity_type: 'warehouse_task',
      entity_id: data.id,
      old_status: null,
      new_status: 'pending',
      actor_id: payload.created_by,
    });
    return data;
  }

  async assign(
    taskId: string,
    tenantId: string,
    assignedTo: string,
    actorId: string,
  ) {
    const { data, error } = await this.supabase.rpc(
      'fn_assign_warehouse_task',
      {
        p_task_id: taskId,
        p_tenant_id: tenantId,
        p_assigned_to: assignedTo,
        p_actor_id: actorId,
      },
    );
    if (error) throw error;
    return data;
  }

  async confirm(
    taskId: string,
    tenantId: string,
    quantity: number,
    confirmedLocationId: string,
    actorId: string,
  ) {
    const { data, error } = await this.supabase.rpc(
      'fn_confirm_warehouse_task',
      {
        p_task_id: taskId,
        p_tenant_id: tenantId,
        p_quantity: quantity,
        p_confirmed_location_id: confirmedLocationId,
        p_actor_id: actorId,
      },
    );
    if (error) throw error;
    return data;
  }

  async cancel(taskId: string, tenantId: string, actorId: string) {
    const { data, error } = await this.supabase.rpc(
      'fn_cancel_warehouse_task',
      {
        p_task_id: taskId,
        p_tenant_id: tenantId,
        p_actor_id: actorId,
      },
    );
    if (error) throw error;
    return data;
  }
}
