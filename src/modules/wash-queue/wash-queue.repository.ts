import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';

export interface WashJob {
  id: string;
  tenant_id: string;
  branch_id: string;
  order_id: string | null;
  customer_id: string | null;
  plate: string;
  vehicle_size: string | null;
  status: 'waiting' | 'washing' | 'ready' | 'delivered' | 'cancelled';
  assigned_worker_id: string | null;
  queue_date: string;
  queue_number: number;
  notes: string | null;
  washing_at: string | null;
  ready_at: string | null;
  delivered_at: string | null;
  cancelled_at: string | null;
  ready_notified_at: string | null;
  created_at: string;
  updated_at: string;
}

@Injectable()
export class WashQueueRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async create(p: {
    tenantId: string;
    branchId: string;
    actorId: string;
    plate: string;
    vehicleSize: string | null;
    orderId: string | null;
    customerId: string | null;
    workerId: string | null;
    notes: string | null;
  }): Promise<WashJob> {
    const { data, error } = await this.supabase.rpc('fn_create_wash_job', {
      p_tenant_id: p.tenantId,
      p_branch_id: p.branchId,
      p_actor_id: p.actorId,
      p_plate: p.plate,
      p_vehicle_size: p.vehicleSize,
      p_order_id: p.orderId,
      p_customer_id: p.customerId,
      p_worker_id: p.workerId,
      p_notes: p.notes,
    });
    if (error) throw error;
    return data as WashJob;
  }

  async transition(
    tenantId: string,
    jobId: string,
    to: string,
    actorId: string,
    allowRewash: boolean,
  ): Promise<WashJob> {
    const { data, error } = await this.supabase.rpc('fn_wash_job_transition', {
      p_tenant_id: tenantId,
      p_job_id: jobId,
      p_to: to,
      p_actor_id: actorId,
      p_allow_rewash: allowRewash,
    });
    if (error) throw error;
    return data as WashJob;
  }

  async assign(
    tenantId: string,
    jobId: string,
    workerId: string | null,
    actorId: string,
  ): Promise<WashJob> {
    const { data, error } = await this.supabase.rpc('fn_wash_job_assign', {
      p_tenant_id: tenantId,
      p_job_id: jobId,
      p_worker_id: workerId,
      p_actor_id: actorId,
    });
    if (error) throw error;
    return data as WashJob;
  }

  async markNotified(tenantId: string, jobId: string): Promise<void> {
    await this.supabase
      .from('wash_jobs')
      .update({ ready_notified_at: new Date().toISOString() })
      .eq('id', jobId)
      .eq('tenant_id', tenantId)
      .eq('status', 'ready');
  }

  // Board = the day's jobs of one branch. Delivered/cancelled stay in the
  // list (the UI shows only the live columns) so the day is auditable.
  async listBoard(
    tenantId: string,
    branchId: string,
    date: string,
  ): Promise<WashJob[]> {
    const { data, error } = await this.supabase
      .from('wash_jobs')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('branch_id', branchId)
      .eq('queue_date', date)
      .is('deleted_at', null)
      .order('queue_number', { ascending: true });
    if (error) throw error;
    return (data ?? []) as WashJob[];
  }

  async findOne(tenantId: string, jobId: string): Promise<WashJob | null> {
    const { data, error } = await this.supabase
      .from('wash_jobs')
      .select('*')
      .eq('id', jobId)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw error;
    return (data as WashJob | null) ?? null;
  }

  async listEvents(tenantId: string, jobId: string) {
    const { data, error } = await this.supabase
      .from('wash_job_events')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('job_id', jobId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data ?? [];
  }
}
