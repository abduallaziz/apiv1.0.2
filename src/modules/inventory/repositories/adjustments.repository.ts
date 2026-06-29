import { Injectable } from '@nestjs/common';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';
import { SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class AdjustmentsRepository extends ScopedRepository {
  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  async findAll(tenantId: string, status?: string) {
    let query = this.supabase
      .from('stock_adjustments')
      .select(
        '*, items(name, sku), warehouses(name, code), requested_by_user:users!stock_adjustments_requested_by_fkey(name), approved_by_user:users!stock_adjustments_approved_by_fkey(name)',
      )
      .eq('tenant_id', tenantId);
    if (status) query = query.eq('status', status);
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  }

  async findById(id: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('stock_adjustments')
      .select(
        '*, items(name, sku), warehouses(name, code), requested_by_user:users!stock_adjustments_requested_by_fkey(name), approved_by_user:users!stock_adjustments_approved_by_fkey(name)',
      )
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single();
    if (error) throw error;
    return data;
  }

  async create(tenantId: string, payload: Record<string, unknown>) {
    const { data, error } = await this.supabase
      .from('stock_adjustments')
      .insert({ ...payload, tenant_id: tenantId })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async approve(id: string, tenantId: string, approvedBy: string) {
    const { data, error } = await this.supabase
      .from('stock_adjustments')
      .update({ status: 'approved', approved_by: approvedBy, approved_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .eq('status', 'pending_approval')
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async reject(id: string, tenantId: string, approvedBy: string) {
    const { data, error } = await this.supabase
      .from('stock_adjustments')
      .update({ status: 'rejected', approved_by: approvedBy, approved_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .eq('status', 'pending_approval')
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async post(adjustmentId: string, actorId: string) {
    const { data, error } = await this.supabase.rpc('fn_post_stock_adjustment', {
      p_adjustment_id: adjustmentId,
      p_actor_id: actorId,
    });
    if (error) throw error;
    return data;
  }
}
