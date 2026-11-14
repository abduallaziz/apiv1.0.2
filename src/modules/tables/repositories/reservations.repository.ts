import { Injectable, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../../shared/supabase/supabase.module';
import { Reservation, ReservationRow } from '../tables.types';

const SELECT =
  'id, table_id, customer_name, customer_phone, party_size, reservation_time, status, notes, created_at, tables(name)';

@Injectable()
export class ReservationsRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  private map(row: ReservationRow): Reservation {
    return { ...row, table_name: row.tables?.name ?? null, tables: undefined };
  }

  async findAll(
    tenantId: string,
    filters: { tableId?: string; from?: string; to?: string; status?: string },
  ) {
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
    return ((data ?? []) as unknown as ReservationRow[]).map((r) =>
      this.map(r),
    );
  }

  async findById(id: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('table_reservations')
      .select(SELECT)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error) throw error;
    return data ? this.map(data as unknown as ReservationRow) : null;
  }

  /** Capacity of a live table of this tenant, or null when it does not exist. */
  async findTable(
    tableId: string,
    tenantId: string,
  ): Promise<{ id: string; capacity: number | null } | null> {
    const { data, error } = await this.supabase
      .from('tables')
      .select('id, capacity')
      .eq('id', tableId)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle<{ id: string; capacity: number | null }>();
    if (error) throw error;
    return data;
  }

  /** Confirmed/seated bookings of a table inside [from, to] (double-booking check). */
  async countActiveInWindow(
    tenantId: string,
    tableId: string,
    from: string,
    to: string,
    excludeId?: string,
  ): Promise<number> {
    let q = this.supabase
      .from('table_reservations')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('table_id', tableId)
      .in('status', ['confirmed', 'seated'])
      .gte('reservation_time', from)
      .lte('reservation_time', to);
    if (excludeId) q = q.neq('id', excludeId);
    const { count, error } = await q;
    if (error) throw error;
    return count ?? 0;
  }

  async remove(id: string, tenantId: string) {
    const { error } = await this.supabase
      .from('table_reservations')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId);
    if (error) throw error;
  }

  async tableBelongsToTenant(
    tableId: string,
    tenantId: string,
  ): Promise<boolean> {
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
    return this.map(data as unknown as ReservationRow);
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
    return this.map(data as unknown as ReservationRow);
  }
}
