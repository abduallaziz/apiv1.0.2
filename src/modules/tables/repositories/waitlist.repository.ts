import { Injectable, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../../shared/supabase/supabase.module';

const SELECT = 'id, branch_id, customer_name, customer_phone, party_size, quoted_wait_minutes, status, table_id, created_at, seated_at';

@Injectable()
export class WaitlistRepository {
  constructor(@Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient) {}

  async findAll(tenantId: string, branchId?: string, status?: string) {
    let q = this.supabase
      .from('waitlist_entries')
      .select(SELECT)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true });
    if (branchId) q = q.eq('branch_id', branchId);
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) throw error;
    return data;
  }

  async findById(id: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('waitlist_entries')
      .select(SELECT)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async branchBelongsToTenant(branchId: string, tenantId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('branches')
      .select('id')
      .eq('id', branchId)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw error;
    return !!data;
  }

  async create(tenantId: string, dto: object) {
    const { data, error } = await this.supabase
      .from('waitlist_entries')
      .insert({ tenant_id: tenantId, ...dto })
      .select(SELECT)
      .single();
    if (error) throw error;
    return data;
  }

  async seat(id: string, tenantId: string, tableId: string) {
    const { data, error } = await this.supabase
      .from('waitlist_entries')
      .update({ status: 'seated', table_id: tableId, seated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select(SELECT)
      .single();
    if (error) throw error;
    return data;
  }

  async cancel(id: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('waitlist_entries')
      .update({ status: 'cancelled' })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select(SELECT)
      .single();
    if (error) throw error;
    return data;
  }
}
