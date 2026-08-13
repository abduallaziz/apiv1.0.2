import { Injectable } from '@nestjs/common';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';
import { SupabaseClient } from '@supabase/supabase-js';
import { PaginationDto } from '../../../shared/dto/pagination.dto';

@Injectable()
export class CountsRepository extends ScopedRepository {
  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  async findAll(
    tenantId: string,
    status?: string,
    pagination: PaginationDto = new PaginationDto(),
  ) {
    const { data, error } = await this.supabase.rpc(
      'fn_stock_counts_list_enriched',
      {
        p_tenant_id: tenantId,
        p_status: status ?? null,
        p_limit: pagination.perPage,
        p_offset: pagination.offset,
      },
    );
    if (error) throw error;
    return data;
  }

  async findById(id: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('stock_counts')
      .select(
        '*, items:stock_count_items(*, items(name, sku), warehouse_locations(code, name))',
      )
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async create(
    tenantId: string,
    payload: Record<string, unknown>,
    startedBy: string,
    scope?: { itemIds?: string[]; locationIds?: string[] },
  ) {
    const { data, error } = await this.supabase
      .from('stock_counts')
      .insert({ ...payload, tenant_id: tenantId, status: 'draft' })
      .select()
      .single();
    if (error) throw error;

    // Snapshot expected quantities from current stock_levels for the warehouse
    // so counters see what the system believes is on hand at count time.
    // For partial/cycle counts, scope narrows this snapshot to the requested
    // items/locations only — the stock calculation itself (quantity_on_hand)
    // is read exactly as before, only the selection is filtered.
    let levelsQuery = this.supabase
      .from('stock_levels')
      .select('item_id, variant_id, batch_id, location_id, quantity_on_hand')
      .eq('tenant_id', tenantId)
      .eq('warehouse_id', data.warehouse_id);
    if (scope?.itemIds?.length)
      levelsQuery = levelsQuery.in('item_id', scope.itemIds);
    if (scope?.locationIds?.length)
      levelsQuery = levelsQuery.in('location_id', scope.locationIds);
    const { data: levels, error: levelsError } = await levelsQuery;
    if (levelsError) throw levelsError;

    if (levels && levels.length > 0) {
      const { error: itemsError } = await this.supabase
        .from('stock_count_items')
        .insert(
          levels.map((l) => ({
            tenant_id: tenantId,
            stock_count_id: data.id,
            item_id: l.item_id,
            variant_id: l.variant_id,
            batch_id: l.batch_id,
            location_id: l.location_id,
            expected_quantity: l.quantity_on_hand,
          })),
        );
      if (itemsError) throw itemsError;
    }

    await this.supabase
      .from('stock_counts')
      .update({
        status: 'in_progress',
        started_by: startedBy,
        started_at: new Date().toISOString(),
      })
      .eq('id', data.id);

    return this.findById(data.id, tenantId);
  }

  async submitCount(
    countItemId: string,
    tenantId: string,
    countedQuantity: number,
    reasonCodeId?: string | null,
  ) {
    const payload: Record<string, unknown> = {
      counted_quantity: countedQuantity,
    };
    if (reasonCodeId !== undefined) payload.reason_code_id = reasonCodeId;

    const { data, error } = await this.supabase
      .from('stock_count_items')
      .update(payload)
      .eq('id', countItemId)
      .eq('tenant_id', tenantId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  // Read-only existence + tenant/applies_to check — reused, not new
  // reason-code infrastructure (table already exists from migration 107).
  async reasonCodeExists(
    reasonCodeId: string,
    tenantId: string,
  ): Promise<boolean> {
    const { count, error } = await this.supabase
      .from('reason_codes')
      .select('id', { count: 'exact', head: true })
      .eq('id', reasonCodeId)
      .eq('tenant_id', tenantId)
      .eq('applies_to', 'count')
      .eq('is_active', true)
      .is('deleted_at', null);
    if (error) throw error;
    return (count ?? 0) > 0;
  }

  // Sum of |counted - expected| * item cost_price across all counted lines —
  // read-only, used only to decide whether the approval threshold is crossed
  // before finalize runs. Mirrors the same cost source fn_finalize_stock_count
  // itself already reads (items.cost_price); does not write to cost_layers
  // or touch the costing engine.
  async computeTotalVarianceValue(
    stockCountId: string,
    tenantId: string,
  ): Promise<number> {
    const { data, error } = await this.supabase
      .from('stock_count_items')
      .select('counted_quantity, expected_quantity, items(cost_price)')
      .eq('stock_count_id', stockCountId)
      .eq('tenant_id', tenantId)
      .not('counted_quantity', 'is', null);
    if (error) throw error;

    return (data ?? []).reduce((sum: number, row: any) => {
      const variance = Math.abs(
        Number(row.counted_quantity) - Number(row.expected_quantity),
      );
      const costPrice = Number(row.items?.cost_price ?? 0);
      return sum + variance * costPrice;
    }, 0);
  }

  async setPendingApproval(stockCountId: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('stock_counts')
      .update({ approval_status: 'pending_approval' })
      .eq('id', stockCountId)
      .eq('tenant_id', tenantId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async finalize(stockCountId: string, actorId: string) {
    const { data, error } = await this.supabase.rpc('fn_finalize_stock_count', {
      p_stock_count_id: stockCountId,
      p_actor_id: actorId,
    });
    if (error) throw error;
    return data;
  }

  // fn_approve_stock_count (migration 107) — unmodified. This is the only
  // write path for approval; it does not itself write to approval_history
  // (confirmed by reading its body), which is exactly the gap Migration
  // 11.1c-fix closes at the TypeScript layer, not by changing this RPC.
  async approve(stockCountId: string, actorId: string, approved: boolean) {
    const { data, error } = await this.supabase.rpc('fn_approve_stock_count', {
      p_stock_count_id: stockCountId,
      p_actor_id: actorId,
      p_approved: approved,
    });
    if (error) throw error;
    return data;
  }
}
