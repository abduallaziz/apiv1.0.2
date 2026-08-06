import { Injectable } from '@nestjs/common';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';
import { SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SnapshotsRepository extends ScopedRepository {
  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  async findAll(tenantId: string) {
    const { data, error } = await this.supabase
      .from('inventory_snapshot_runs')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('snapshot_date', { ascending: false });
    if (error) throw error;
    return data;
  }

  async findById(id: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('inventory_snapshot_runs')
      .select('*, items:inventory_snapshot_items(*, items(name, sku), warehouses(name, code))')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async findActiveForDate(tenantId: string, snapshotDate: string) {
    const { data, error } = await this.supabase
      .from('inventory_snapshot_runs')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('snapshot_date', snapshotDate)
      .eq('status', 'active')
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  // The only write path in this repository — delegates entirely to
  // fn_generate_inventory_snapshot (148). No direct inserts/updates against
  // inventory_snapshot_runs/items, stock_levels, stock_movements, or
  // cost_layers anywhere in this file.
  async generate(tenantId: string, actorId: string | null, snapshotDate?: string, supersede?: boolean) {
    const { data, error } = await this.supabase.rpc('fn_generate_inventory_snapshot', {
      p_tenant_id: tenantId,
      p_actor_id: actorId,
      p_snapshot_date: snapshotDate ?? new Date().toISOString().slice(0, 10),
      p_supersede: supersede ?? false,
    });
    if (error) throw error;
    return data;
  }
}
