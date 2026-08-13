import { ConflictException, Injectable, BadRequestException } from '@nestjs/common';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';
import { SupabaseClient } from '@supabase/supabase-js';

const SORTABLE_COLUMNS = new Set(['code', 'name', 'zone', 'is_active', 'created_at', 'updated_at']);

interface PostgrestError {
  code?: string;
  message?: string;
  details?: string;
}

function isPostgrestError(error: unknown): error is PostgrestError {
  return typeof error === 'object' && error !== null && 'code' in error;
}

// Translates known Postgres constraint violations into actionable HTTP errors
// instead of letting them fall through to the generic 500 handler.
function toHttpError(error: unknown): unknown {
  if (!isPostgrestError(error)) return error;

  if (error.code === '23505') {
    return new ConflictException('Location code already exists in this warehouse');
  }
  if (error.code === '23503') {
    return new BadRequestException('The selected warehouse does not exist');
  }
  return error;
}

@Injectable()
export class LocationsRepository extends ScopedRepository {
  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  async findAll(
    warehouseId: string,
    tenantId: string,
    options: {
      search?: string;
      page?: number;
      limit?: number;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
      isActive?: boolean;
    } = {},
  ) {
    const page = options.page && options.page > 0 ? options.page : 1;
    const limit = options.limit && options.limit > 0 ? options.limit : 20;
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    const sortBy = options.sortBy && SORTABLE_COLUMNS.has(options.sortBy) ? options.sortBy : 'code';
    const ascending = options.sortOrder !== 'desc';

    let query = this.supabase
      .from('warehouse_locations')
      .select('*', { count: 'exact' })
      .eq('warehouse_id', warehouseId)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null);

    if (options.search) {
      const term = options.search.replace(/[%,]/g, '');
      query = query.or(`code.ilike.%${term}%,name.ilike.%${term}%`);
    }

    if (options.isActive !== undefined) {
      query = query.eq('is_active', options.isActive);
    }

    const { data, error, count } = await query.order(sortBy, { ascending }).range(from, to);
    if (error) throw error;
    return { data, total: count ?? 0, page, limit };
  }

  async findById(id: string, warehouseId: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('warehouse_locations')
      .select('*')
      .eq('id', id)
      .eq('warehouse_id', warehouseId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async create(warehouseId: string, tenantId: string, payload: Record<string, unknown>) {
    const { data, error } = await this.supabase
      .from('warehouse_locations')
      .insert({ ...payload, warehouse_id: warehouseId, tenant_id: tenantId, is_active: payload.is_active ?? true })
      .select()
      .single();
    if (error) throw toHttpError(error);
    return data;
  }

  async setRestrictions(
    tenantId: string,
    locationId: string,
    itemIds: string[],
    categoryIds: string[],
  ) {
    await this.supabase.from('warehouse_location_restrictions').delete().eq('tenant_id', tenantId).eq('location_id', locationId);
    const rows = [
      ...itemIds.map((item_id) => ({ tenant_id: tenantId, location_id: locationId, item_id })),
      ...categoryIds.map((category_id) => ({ tenant_id: tenantId, location_id: locationId, category_id })),
    ];
    if (rows.length === 0) return [];
    const { data, error } = await this.supabase.from('warehouse_location_restrictions').insert(rows).select();
    if (error) throw toHttpError(error);
    return data;
  }

  async getRestrictions(tenantId: string, locationId: string) {
    const { data, error } = await this.supabase
      .from('warehouse_location_restrictions')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('location_id', locationId);
    if (error) throw toHttpError(error);
    return data;
  }

  async update(id: string, warehouseId: string, tenantId: string, payload: Record<string, unknown>) {
    const { data, error } = await this.supabase
      .from('warehouse_locations')
      .update(payload)
      .eq('id', id)
      .eq('warehouse_id', warehouseId)
      .eq('tenant_id', tenantId)
      .select()
      .single();
    if (error) throw toHttpError(error);
    return data;
  }

  // Tenant-wide lookup by code, used by the Scanner Resolver Engine
  // (#21 Phase 5). Deliberately NOT scoped to a single warehouse — the
  // uniqueness constraint on `code` is only per-warehouse (uq_locations_
  // warehouse_code), so the same code can legitimately exist in more than
  // one warehouse within a tenant. Callers must handle a multi-row result
  // as an ambiguous match, same as ItemBarcodesRepository's counterpart
  // for serial numbers (item_serials.findByNumber).
  async findByCode(code: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('warehouse_locations')
      .select('*, warehouses(id, name)')
      .eq('code', code)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null);
    if (error) throw error;
    return data ?? [];
  }

  async softDelete(id: string, warehouseId: string, tenantId: string) {
    const { error } = await this.supabase
      .from('warehouse_locations')
      .update({ deleted_at: new Date().toISOString(), is_active: false })
      .eq('id', id)
      .eq('warehouse_id', warehouseId)
      .eq('tenant_id', tenantId);
    if (error) throw error;
  }
}
