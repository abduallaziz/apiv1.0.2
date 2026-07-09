import { Injectable } from '@nestjs/common';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';
import { SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class ReservationsRepository extends ScopedRepository {
  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  async findAll(tenantId: string, status?: string) {
    let query = this.supabase
      .from('stock_reservations')
      .select('*, items(name, sku), warehouses(name, code)')
      .eq('tenant_id', tenantId);
    if (status) query = query.eq('status', status);
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  }

  async findById(id: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('stock_reservations')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async create(params: {
    p_tenant_id: string;
    p_warehouse_id: string;
    p_item_id: string;
    p_variant_id: string | null;
    p_batch_id: string | null;
    p_quantity: number;
    p_reference_type: string;
    p_reference_id: string;
    p_created_by: string | null;
    p_expires_at: string | null;
  }) {
    const { data, error } = await this.supabase.rpc('fn_create_reservation', params);
    if (error) throw error;
    return data;
  }

  async release(reservationId: string, resultingStatus: 'released' | 'consumed' | 'expired' = 'released') {
    const { data, error } = await this.supabase.rpc('fn_release_reservation', {
      p_reservation_id: reservationId,
      p_resulting_status: resultingStatus,
    });
    if (error) throw error;
    return data;
  }
}
