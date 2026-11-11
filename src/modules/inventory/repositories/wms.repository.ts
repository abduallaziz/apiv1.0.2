import { Injectable } from '@nestjs/common';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';
import { SupabaseClient } from '@supabase/supabase-js';
import {
  ShipmentsQueryDto,
  PickListsQueryDto,
  WavesQueryDto,
  ExceptionsQueryDto,
  PagedResult,
} from '../dto/wms-list-query.dto';

@Injectable()
export class WmsRepository extends ScopedRepository {
  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  // Inventory #7 / F17 (Owner-approved) — `query.page` is the branch
  // point: omitted preserves the exact pre-existing unpaginated behavior
  // (plain array, current default sort/filter shape) for every existing
  // caller; provided returns the new {data,total,page,perPage} envelope.
  // Filters are applied identically to both the data query and the count
  // query (run in parallel), matching the customers/items/transfers
  // convention exactly — this is the one detail the F17 audit flagged as
  // easy to get wrong.
  async findShipments(tenantId: string, status?: string): Promise<unknown[]>;
  async findShipments(
    tenantId: string,
    query: ShipmentsQueryDto,
  ): Promise<unknown[] | PagedResult<unknown>>;
  async findShipments(tenantId: string, arg?: string | ShipmentsQueryDto) {
    const q: ShipmentsQueryDto = typeof arg === 'string' ? { status: arg } : (arg ?? {});

    const applyFilters = (query: any) => {
      if (q.status) query = query.eq('status', q.status);
      if (q.warehouse_id) query = query.eq('warehouse_id', q.warehouse_id);
      if (q.date_from) query = query.gte('created_at', q.date_from);
      if (q.date_to) query = query.lt('created_at', q.date_to);
      return query;
    };

    if (!q.page) {
      let query = this.supabase
        .from('shipments')
        .select(
          '*, warehouses(name, code), lines:shipment_lines(*, items(name, sku))',
        )
        .eq('tenant_id', tenantId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
      query = applyFilters(query);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    }

    const page = q.page;
    const limit = q.limit ?? 20;
    const sortBy = q.sortBy ?? 'created_at';
    const sortOrder = q.sortOrder ?? 'desc';

    let dataQuery = this.supabase
      .from('shipments')
      .select(
        '*, warehouses(name, code), lines:shipment_lines(*, items(name, sku))',
      )
      .eq('tenant_id', tenantId)
      .is('deleted_at', null);
    dataQuery = applyFilters(dataQuery);
    dataQuery = dataQuery
      .order(sortBy, { ascending: sortOrder === 'asc' })
      .order('id', { ascending: true })
      .range((page - 1) * limit, page * limit - 1);

    let countQuery = this.supabase
      .from('shipments')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .is('deleted_at', null);
    countQuery = applyFilters(countQuery);

    const [{ data, error }, { count, error: countError }] = await Promise.all([
      dataQuery,
      countQuery,
    ]);
    if (error) throw error;
    if (countError) throw countError;
    return { data, total: count ?? 0, page, perPage: limit } as PagedResult<unknown>;
  }

  async findShipmentById(id: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('shipments')
      .select(
        '*, warehouses(name, code), lines:shipment_lines(*, items(name, sku))',
      )
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async createShipment(
    tenantId: string,
    payload: Record<string, unknown>,
    lines: Record<string, unknown>[],
  ) {
    const { data: shipment, error } = await this.supabase
      .from('shipments')
      .insert({ ...payload, tenant_id: tenantId })
      .select()
      .single();
    if (error) throw error;

    const { error: linesError } = await this.supabase
      .from('shipment_lines')
      .insert(
        lines.map((l) => ({
          ...l,
          tenant_id: tenantId,
          shipment_id: shipment.id,
        })),
      );
    if (linesError) throw linesError;

    return this.findShipmentById(shipment.id, tenantId);
  }

  // Inventory #7 / 7-7 (Owner-approved) — reconciled to the same reason/
  // actor contract fn_cancel_pick_list/fn_cancel_wave already use.
  async cancelShipment(
    id: string,
    tenantId: string,
    reason: string,
    actorId: string,
  ) {
    const { data, error } = await this.supabase.rpc('fn_cancel_shipment', {
      p_shipment_id: id,
      p_tenant_id: tenantId,
      p_reason: reason,
      p_actor_id: actorId,
    });
    if (error) throw error;
    return data;
  }

  async recordShortPick(
    shipmentLineId: string,
    tenantId: string,
    reason: string,
    actorId: string,
  ) {
    const { data, error } = await this.supabase.rpc('fn_record_short_pick', {
      p_shipment_line_id: shipmentLineId,
      p_tenant_id: tenantId,
      p_reason: reason,
      p_actor_id: actorId,
    });
    if (error) throw error;
    return data;
  }

  async recordDamage(
    shipmentLineId: string,
    tenantId: string,
    quantity: number,
    reason: string,
    actorId: string,
  ) {
    const { data, error } = await this.supabase.rpc('fn_record_damage', {
      p_shipment_line_id: shipmentLineId,
      p_tenant_id: tenantId,
      p_quantity: quantity,
      p_reason: reason,
      p_actor_id: actorId,
    });
    if (error) throw error;
    return data;
  }

  async recordLostItem(
    shipmentLineId: string,
    tenantId: string,
    quantity: number,
    reason: string,
    actorId: string,
  ) {
    const { data, error } = await this.supabase.rpc('fn_record_lost_item', {
      p_shipment_line_id: shipmentLineId,
      p_tenant_id: tenantId,
      p_quantity: quantity,
      p_reason: reason,
      p_actor_id: actorId,
    });
    if (error) throw error;
    return data;
  }

  async recoverLostItem(
    exceptionId: string,
    tenantId: string,
    quantity: number,
    reason: string,
    actorId: string,
    unitCost?: number,
  ) {
    const { data, error } = await this.supabase.rpc('fn_recover_lost_item', {
      p_exception_id: exceptionId,
      p_tenant_id: tenantId,
      p_quantity: quantity,
      p_reason: reason,
      p_actor_id: actorId,
      p_unit_cost: unitCost ?? null,
    });
    if (error) throw error;
    return data;
  }

  // warehouse_id filtering (which requires resolving through
  // shipment_lines/shipments, since warehouse_exceptions carries no
  // warehouse_id column) is intentionally not duplicated here — the
  // dedicated wms-dashboard listExceptionsDrillDown already covers that
  // exact use case with pagination; this method stays entity/type-scoped.
  async findExceptions(
    tenantId: string,
    entityType?: string,
    entityId?: string,
  ): Promise<unknown[]>;
  async findExceptions(
    tenantId: string,
    query: ExceptionsQueryDto,
  ): Promise<unknown[] | PagedResult<unknown>>;
  async findExceptions(
    tenantId: string,
    arg2?: string | ExceptionsQueryDto,
    arg3?: string,
  ) {
    let q: ExceptionsQueryDto;
    if (typeof arg2 === 'object') {
      q = arg2;
    } else {
      q = { entity_type: arg2, entity_id: arg3 };
    }

    const applyFilters = (query: any) => {
      if (q.entity_type) query = query.eq('entity_type', q.entity_type);
      if (q.entity_id) query = query.eq('entity_id', q.entity_id);
      if (q.exception_type) query = query.eq('exception_type', q.exception_type);
      if (q.date_from) query = query.gte('created_at', q.date_from);
      if (q.date_to) query = query.lt('created_at', q.date_to);
      return query;
    };

    if (!q.page) {
      let query = this.supabase
        .from('warehouse_exceptions')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false });
      query = applyFilters(query);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    }

    const page = q.page;
    const limit = q.limit ?? 20;
    const sortBy = q.sortBy ?? 'created_at';
    const sortOrder = q.sortOrder ?? 'desc';

    let dataQuery = this.supabase
      .from('warehouse_exceptions')
      .select('*')
      .eq('tenant_id', tenantId);
    dataQuery = applyFilters(dataQuery);
    dataQuery = dataQuery
      .order(sortBy, { ascending: sortOrder === 'asc' })
      .order('id', { ascending: true })
      .range((page - 1) * limit, page * limit - 1);

    let countQuery = this.supabase
      .from('warehouse_exceptions')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId);
    countQuery = applyFilters(countQuery);

    const [{ data, error }, { count, error: countError }] = await Promise.all([
      dataQuery,
      countQuery,
    ]);
    if (error) throw error;
    if (countError) throw countError;
    return { data, total: count ?? 0, page, perPage: limit } as PagedResult<unknown>;
  }

  async shipShipment(id: string, actorId: string, trackingNumber?: string) {
    const { data, error } = await this.supabase.rpc('fn_ship_shipment', {
      p_shipment_id: id,
      p_actor_id: actorId,
      p_tracking_number: trackingNumber ?? null,
    });
    if (error) throw error;
    return data;
  }

  /** True only if the shipment line exists in this tenant. */
  async shipmentLineBelongsToTenant(
    shipmentLineId: string,
    tenantId: string,
  ): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('shipment_lines')
      .select('id')
      .eq('id', shipmentLineId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error) throw error;
    return !!data;
  }

  async confirmPack(shipmentLineId: string, quantity: number, actorId: string) {
    const { data, error } = await this.supabase.rpc('fn_confirm_pack', {
      p_shipment_line_id: shipmentLineId,
      p_quantity: quantity,
      p_actor_id: actorId,
    });
    if (error) throw error;
    return data;
  }

  async findPickLists(tenantId: string, status?: string): Promise<unknown[]>;
  async findPickLists(
    tenantId: string,
    query: PickListsQueryDto,
  ): Promise<unknown[] | PagedResult<unknown>>;
  async findPickLists(tenantId: string, arg?: string | PickListsQueryDto) {
    const q: PickListsQueryDto = typeof arg === 'string' ? { status: arg } : (arg ?? {});
    const select =
      '*, warehouses(name, code), shipments:pick_list_shipments(shipment_id), lines:pick_list_lines(*, items(name, sku))';

    const applyFilters = (query: any) => {
      if (q.status) query = query.eq('status', q.status);
      if (q.warehouse_id) query = query.eq('warehouse_id', q.warehouse_id);
      if (q.priority) query = query.eq('priority', q.priority);
      if (q.strategy) query = query.eq('strategy', q.strategy);
      return query;
    };

    if (!q.page) {
      let query = this.supabase
        .from('pick_lists')
        .select(select)
        .eq('tenant_id', tenantId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
      query = applyFilters(query);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    }

    const page = q.page;
    const limit = q.limit ?? 20;
    const sortBy = q.sortBy ?? 'created_at';
    const sortOrder = q.sortOrder ?? 'desc';

    let dataQuery = this.supabase
      .from('pick_lists')
      .select(select)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null);
    dataQuery = applyFilters(dataQuery);
    dataQuery = dataQuery
      .order(sortBy, { ascending: sortOrder === 'asc' })
      .order('id', { ascending: true })
      .range((page - 1) * limit, page * limit - 1);

    let countQuery = this.supabase
      .from('pick_lists')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .is('deleted_at', null);
    countQuery = applyFilters(countQuery);

    const [{ data, error }, { count, error: countError }] = await Promise.all([
      dataQuery,
      countQuery,
    ]);
    if (error) throw error;
    if (countError) throw countError;
    return { data, total: count ?? 0, page, perPage: limit } as PagedResult<unknown>;
  }

  async findPickListById(id: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('pick_lists')
      .select(
        '*, warehouses(name, code), shipments:pick_list_shipments(shipment_id), lines:pick_list_lines(*, items(name, sku))',
      )
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw error;
    if (!data) return data;

    // Inventory #7 / F3 residual (Owner-approved) — per-line exception_quantity.
    // warehouse_exceptions supports entity_type='pick_list_line', but fetching
    // it per line would be N+1. This is the "Option 1" server-side aggregate:
    // one bounded extra query (IN over this pick list's own line ids, never
    // more than a few dozen rows for a real pick list), summed and attached
    // client-side in this one response — not a per-request loop, not a
    // global exceptions fetch, no new storage or business logic invented.
    const lineIds = ((data as { lines?: { id: string }[] }).lines ?? []).map((l) => l.id);
    if (lineIds.length > 0) {
      const { data: lineExceptions, error: excError } = await this.supabase
        .from('warehouse_exceptions')
        .select('entity_id, affected_quantity')
        .eq('tenant_id', tenantId)
        .eq('entity_type', 'pick_list_line')
        .in('entity_id', lineIds);
      if (excError) throw excError;

      const exceptionQtyByLine = new Map<string, number>();
      for (const exc of lineExceptions ?? []) {
        const prev = exceptionQtyByLine.get(exc.entity_id) ?? 0;
        exceptionQtyByLine.set(exc.entity_id, prev + Number(exc.affected_quantity ?? 0));
      }
      for (const line of (data as { lines: { id: string; exception_quantity?: number }[] }).lines) {
        line.exception_quantity = exceptionQtyByLine.get(line.id) ?? 0;
      }
    }

    return data;
  }

  async createPickList(
    tenantId: string,
    warehouseId: string,
    shipmentIds: string[],
    strategy: string,
    zoneLocationId: string | null,
    actorId: string,
    priority?: string,
  ) {
    const { data, error } = await this.supabase.rpc('fn_create_pick_list', {
      p_tenant_id: tenantId,
      p_warehouse_id: warehouseId,
      p_shipment_ids: shipmentIds,
      p_strategy: strategy,
      p_zone_location_id: zoneLocationId,
      p_actor_id: actorId,
      p_priority: priority ?? 'medium',
    });
    if (error) throw error;
    return data;
  }

  // Inventory #7 / 7-4/7-5 (Owner-approved) — Wave create + evaluate.
  // Creation is a trivial single-table insert (planning status is the
  // table default) — no RPC needed for it, matching the pattern already
  // used for plain reads elsewhere in this repository.
  async createWave(
    tenantId: string,
    warehouseId: string,
    criteria: Record<string, unknown> | undefined,
    actorId: string,
  ) {
    const { data, error } = await this.supabase
      .from('waves')
      .insert({
        tenant_id: tenantId,
        warehouse_id: warehouseId,
        criteria: criteria ?? {},
        created_by: actorId,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async findWaves(tenantId: string, status?: string): Promise<unknown[]>;
  async findWaves(
    tenantId: string,
    query: WavesQueryDto,
  ): Promise<unknown[] | PagedResult<unknown>>;
  async findWaves(tenantId: string, arg?: string | WavesQueryDto) {
    const q: WavesQueryDto = typeof arg === 'string' ? { status: arg } : (arg ?? {});

    const applyFilters = (query: any) => {
      if (q.status) query = query.eq('status', q.status);
      if (q.warehouse_id) query = query.eq('warehouse_id', q.warehouse_id);
      return query;
    };

    if (!q.page) {
      let query = this.supabase.from('waves').select('*').eq('tenant_id', tenantId);
      query = applyFilters(query);
      const { data, error } = await query.order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    }

    const page = q.page;
    const limit = q.limit ?? 20;
    const sortBy = q.sortBy ?? 'created_at';
    const sortOrder = q.sortOrder ?? 'desc';

    let dataQuery = this.supabase.from('waves').select('*').eq('tenant_id', tenantId);
    dataQuery = applyFilters(dataQuery);
    dataQuery = dataQuery
      .order(sortBy, { ascending: sortOrder === 'asc' })
      .order('id', { ascending: true })
      .range((page - 1) * limit, page * limit - 1);

    let countQuery = this.supabase
      .from('waves')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId);
    countQuery = applyFilters(countQuery);

    const [{ data, error }, { count, error: countError }] = await Promise.all([
      dataQuery,
      countQuery,
    ]);
    if (error) throw error;
    if (countError) throw countError;
    return { data, total: count ?? 0, page, perPage: limit } as PagedResult<unknown>;
  }

  async findWaveById(id: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('waves')
      .select('*, wave_shipments(*)')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async evaluateWaveEligibility(
    waveId: string,
    tenantId: string,
    actorId: string,
  ) {
    const { data, error } = await this.supabase.rpc(
      'fn_evaluate_wave_eligibility',
      { p_wave_id: waveId, p_tenant_id: tenantId, p_actor_id: actorId },
    );
    if (error) throw error;
    return data;
  }

  // Inventory #7 / 7-6 (Owner-approved) — atomic Claim+Release. Single RPC:
  // claim is a sub-step inside fn_release_wave's transaction, not a
  // separate call (see migration 237 for the full architecture rationale).
  async releaseWave(
    waveId: string,
    tenantId: string,
    actorId: string,
    priority?: string,
  ) {
    const { data, error } = await this.supabase.rpc('fn_release_wave', {
      p_wave_id: waveId,
      p_tenant_id: tenantId,
      p_actor_id: actorId,
      p_priority: priority ?? 'medium',
    });
    if (error) throw error;
    return data;
  }

  async cancelWave(
    waveId: string,
    tenantId: string,
    reason: string,
    actorId: string,
  ) {
    const { data, error } = await this.supabase.rpc('fn_cancel_wave', {
      p_wave_id: waveId,
      p_tenant_id: tenantId,
      p_reason: reason,
      p_actor_id: actorId,
    });
    if (error) throw error;
    return data;
  }

  // Inventory #7 / 7-3 (Owner-approved) — automatic multi-zone splitting.
  // Returns SETOF pick_lists (one row per zone actually covered).
  async createZoneSplitPickLists(
    tenantId: string,
    warehouseId: string,
    shipmentIds: string[],
    actorId: string,
    priority?: string,
  ) {
    const { data, error } = await this.supabase.rpc(
      'fn_create_zone_pick_lists_for_shipments',
      {
        p_tenant_id: tenantId,
        p_warehouse_id: warehouseId,
        p_shipment_ids: shipmentIds,
        p_actor_id: actorId,
        p_priority: priority ?? 'medium',
      },
    );
    if (error) throw error;
    return data;
  }

  // Inventory #7 / 7-2 (Owner-approved) — real assignment/reassignment;
  // pick_lists.assigned_to was declared but never set before this item.
  async assignPickList(
    pickListId: string,
    tenantId: string,
    assignedTo: string,
    actorId: string,
  ) {
    const { data, error } = await this.supabase.rpc('fn_assign_pick_list', {
      p_pick_list_id: pickListId,
      p_tenant_id: tenantId,
      p_assigned_to: assignedTo,
      p_actor_id: actorId,
    });
    if (error) throw error;
    return data;
  }

  // Inventory #7 / 7-2 (Owner-approved) — no pick-list-level cancel
  // existed before this item (only fn_cancel_shipment, shipment-scoped).
  async cancelPickList(
    pickListId: string,
    tenantId: string,
    reason: string,
    actorId: string,
  ) {
    const { data, error } = await this.supabase.rpc('fn_cancel_pick_list', {
      p_pick_list_id: pickListId,
      p_tenant_id: tenantId,
      p_reason: reason,
      p_actor_id: actorId,
    });
    if (error) throw error;
    return data;
  }

  // Inventory #7 / 7-2 (Owner-approved) — pick lists now have proper
  // status/audit history via the shared warehouse_work_status_history
  // table (7-1/7-2), mirroring WarehouseTasksRepository.findHistory().
  async findPickListHistory(pickListId: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('warehouse_work_status_history')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('entity_type', 'pick_list')
      .eq('entity_id', pickListId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  }

  // Inventory #7 / F7 gap closure (Owner-approved, read-only — no schema
  // change) — same real warehouse_work_status_history source
  // fn_evaluate_wave_eligibility/fn_release_wave/fn_cancel_wave already
  // write to (entity_type='wave'), exposed via the exact same pattern as
  // findPickListHistory above. No new table, no new storage.
  async findWaveHistory(waveId: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('warehouse_work_status_history')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('entity_type', 'wave')
      .eq('entity_id', waveId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  }

  async confirmPick(pickListLineId: string, quantity: number, actorId: string) {
    const { data, error } = await this.supabase.rpc('fn_confirm_pick', {
      p_pick_list_line_id: pickListLineId,
      p_quantity: quantity,
      p_actor_id: actorId,
    });
    if (error) throw error;
    return data;
  }

  async findPickListLineWithContext(pickListLineId: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('pick_list_lines')
      .select('*, pick_lists(warehouse_id)')
      .eq('id', pickListLineId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  // Enterprise validation gate (migration 171) — called BEFORE
  // fn_confirm_pick, never inside it, so the existing tested picking
  // engine (migration 116) stays untouched. Raises via
  // fn_validate_pick_requirements if the item needs a batch/serial that
  // wasn't given, or if FEFO would be violated.
  async validatePickRequirements(
    tenantId: string,
    warehouseId: string,
    itemId: string,
    variantId: string | null,
    quantity: number,
    batchId: string | null,
  ) {
    const { error } = await this.supabase.rpc('fn_validate_pick_requirements', {
      p_tenant_id: tenantId,
      p_warehouse_id: warehouseId,
      p_item_id: itemId,
      p_variant_id: variantId,
      p_quantity: quantity,
      p_batch_id: batchId,
    });
    if (error) throw error;
  }

  async setPickListLineBatch(
    pickListLineId: string,
    tenantId: string,
    batchId: string,
  ) {
    const { error } = await this.supabase
      .from('pick_list_lines')
      .update({ batch_id: batchId })
      .eq('id', pickListLineId)
      .eq('tenant_id', tenantId);
    if (error) throw error;
  }
}
