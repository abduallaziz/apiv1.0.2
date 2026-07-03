import { Injectable, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../../shared/supabase/supabase.module';

const SELECT = 'id, table_id, customer_name, customer_phone, party_size, reservation_time, status, notes, created_at, tables(name)';

@Injectable()
export class ReservationsRepository {
  constructor(@Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient) {}

  private map(row: any) {
    return { ...row, table_name: row.tables?.name ?? null, tables: undefined };
  }

  async findAll(tenantId: string, filters: { tableId?: string; from?: string; to?: string; status?: string }) {
    let q = this.supabase
      .from('table_reservations')
      .select(SELECT)
      .eq('tenant_id', tenantId)
      .order('reservation_time', { ascending: true });
    if (filters.tableId) q = q.eq('table_id', filters.tableId);
    if (filters.status) q = q.eq('status', filters.status);
    if (filters.from) q = q.gte('reservation_time', filters.from);
    if (filters.to) q = q.lte('reservation_time', filters.to);

    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map((r) => this.map(r));
  }

  async findById(id: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('table_reservations')
      .select(SELECT)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error) throw error;
    return data ? this.map(data) : null;
  }

  async tableBelongsToTenant(tableId: string, tenantId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('tables')
      .select('id')
      .eq('id', tableId)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw error;
    return !!data;
  }

  async create(tenantId: string, dto: object) {
    const { data, error } = await this.supabase
      .from('table_reservations')
      .insert({ tenant_id: tenantId, ...dto })
      .select(SELECT)
      .single();
    if (error) throw error;
    return this.map(data);
  }

  async update(id: string, tenantId: string, dto: object) {
    const { data, error } = await this.supabase
      .from('table_reservations')
      .update(dto)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select(SELECT)
      .single();
    if (error) throw error;
    return this.map(data);
  }
}
