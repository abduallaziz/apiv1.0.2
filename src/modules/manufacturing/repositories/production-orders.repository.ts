import { ConflictException, Injectable } from '@nestjs/common';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';
import { SupabaseClient } from '@supabase/supabase-js';
import { TenantContext } from '../../../core/tenant/tenant.context';
import { PaginationDto } from '../../../shared/dto/pagination.dto';

interface PostgrestError {
  code?: string;
  message?: string;
}

function isPostgrestError(error: unknown): error is PostgrestError {
  return typeof error === 'object' && error !== null && 'code' in error;
}

function toHttpError(error: unknown): unknown {
  if (isPostgrestError(error) && error.code === '23505') {
    return new ConflictException(
      'A production order with this number already exists',
    );
  }
  return error;
}

@Injectable()
export class ProductionOrdersRepository extends ScopedRepository {
  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  private ctx(tenantId: string): TenantContext {
    return { tenantId } as TenantContext;
  }

  // Nested embed pulling the BOM's own output item name for list display —
  // same `!<fk_constraint>(...)` syntax already proven throughout the
  // codebase (TransfersRepository, users.repository.ts, adjustments.repository.ts,
  // invoices.repository.ts). Read-only projection, not BOM business logic.
  private static readonly LIST_SELECT = `*,
    warehouse:warehouses!production_orders_warehouse_id_fkey(name, code),
    bom:bill_of_materials!production_orders_bom_id_fkey(
      item:items!bill_of_materials_item_id_fkey(name, sku)
    )`;

  private static readonly DETAIL_SELECT = `*,
    warehouse:warehouses!production_orders_warehouse_id_fkey(name, code),
    work_center:work_centers!production_orders_work_center_id_fkey(name, is_active),
    created_by_user:users!production_orders_created_by_fkey(name, email)`;

  async findAll(
    tenantId: string,
    filters: {
      status?: string;
      warehouse_id?: string;
      date_from?: string;
      date_to?: string;
      search?: string;
      sort?: string;
      dir?: 'asc' | 'desc';
    } = {},
    pagination: PaginationDto = new PaginationDto(),
  ): Promise<{ data: unknown[]; total: number }> {
    const [from, to] = pagination.range;
    let q = this.supabase
      .from('production_orders')
      .select(ProductionOrdersRepository.LIST_SELECT, { count: 'exact' })
      .eq('tenant_id', tenantId);

    if (filters.status) q = q.eq('status', filters.status);
    if (filters.warehouse_id) q = q.eq('warehouse_id', filters.warehouse_id);
    if (filters.date_from) q = q.gte('created_at', filters.date_from);
    if (filters.date_to) q = q.lte('created_at', filters.date_to);
    if (filters.search) q = q.ilike('order_number', `%${filters.search}%`);

    const sort = filters.sort ?? 'created_at';
    const ascending = filters.dir !== 'desc';

    const { data, error, count } = await q
      .order(sort, { ascending })
      .range(from, to);
    if (error) throw error;
    return { data: data ?? [], total: count ?? 0 };
  }

  async findById(id: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('production_orders')
      .select(ProductionOrdersRepository.DETAIL_SELECT)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  // Read-only audit trail for "consumed quantity" per component — reuses the
  // existing, already-immutable stock_movements ledger (no new table, no
  // write path). Only ever meaningful for a completed order (fn_post_
  // production_order is the only writer of these rows).
  async findConsumptionMovements(tenantId: string, productionOrderId: string) {
    const { data, error } = await this.supabase
      .from('stock_movements')
      .select(
        'item_id, variant_id, quantity, unit_cost, total_cost, movement_type',
      )
      .eq('tenant_id', tenantId)
      .eq('reference_type', 'production_order')
      .eq('reference_id', productionOrderId)
      .eq('movement_type', 'production_consumption');
    if (error) throw error;
    return data ?? [];
  }

  // Migration 13.16B — the exact stock_movements row fn_post_production_order
  // (untouched) already created for the main product's receipt. Read-only
  // lookup, used only to mirror it into production_order_outputs for
  // visibility — never re-derives or recomputes the cost.
  //
  // Filtered by item_id/variant_id (the BOM's own output item), not just
  // movement_type='production_receipt' + reference_id — by-product outputs
  // (Migration 13.16B) deliberately reuse the same 'production_receipt'
  // movement_type ("use existing production receipt patterns, do not
  // create a duplicate inventory system"), so without this filter a
  // by-product sharing the same order could be mistaken for the main
  // product's own receipt.
  async findMainReceiptMovement(
    tenantId: string,
    productionOrderId: string,
    itemId: string,
    variantId: string | null,
  ) {
    let query = this.supabase
      .from('stock_movements')
      .select('id, item_id, variant_id, quantity, unit_cost')
      .eq('tenant_id', tenantId)
      .eq('reference_type', 'production_order')
      .eq('reference_id', productionOrderId)
      .eq('movement_type', 'production_receipt')
      .eq('item_id', itemId);
    query = variantId
      ? query.eq('variant_id', variantId)
      : query.is('variant_id', null);
    const { data, error } = await query
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async create(tenantId: string, payload: Record<string, unknown>) {
    const { data, error } = await this.supabase
      .from('production_orders')
      .insert({ ...payload, tenant_id: tenantId, status: 'draft' })
      .select()
      .single();
    if (error) throw toHttpError(error);
    return data;
  }

  async update(id: string, tenantId: string, payload: Record<string, unknown>) {
    const { data, error } = await this.supabase
      .from('production_orders')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .eq('status', 'draft')
      .select()
      .maybeSingle();
    if (error) throw toHttpError(error);
    return data;
  }

  async start(id: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('production_orders')
      .update({
        status: 'in_progress',
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .eq('status', 'draft')
      .select()
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  // Migration 6.8 — cancellation allowed from draft OR in_progress. No stock
  // reversal needed either way: fn_post_production_order is the only thing
  // that ever moves stock, and it hasn't run yet in either source status.
  async cancel(id: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('production_orders')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .in('status', ['draft', 'in_progress'])
      .select()
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  // The only stock-mutating call in this repository — delegates entirely to
  // fn_post_production_order (migrations 112/140). No direct stock_levels/
  // stock_movements/cost_layers writes anywhere in this file.
  async complete(
    id: string,
    actorId: string | null,
    quantityProduced?: number,
  ) {
    const { data, error } = await this.supabase.rpc(
      'fn_post_production_order',
      {
        p_production_order_id: id,
        p_actor_id: actorId,
        p_quantity_produced: quantityProduced ?? null,
      },
    );
    if (error) throw error;
    return data;
  }
}
