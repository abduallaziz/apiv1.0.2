import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';
import { ScopedRepository } from '../../core/tenant/scoped.repository';
import { TenantContext } from '../../core/tenant/tenant-context';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { isUniqueViolation } from '../../shared/supabase/postgrest-error.util';
import { CustomerSortField } from './dto/customer-query.dto';
import { normalizePhone } from './customer-normalize';
import {
  localDayBoundIso,
  safeTimezone,
} from '../../shared/time/tenant-time.util';
import {
  CustomerRow,
  CustomerVehicleRow,
  IdRow,
  OrderHistoryRow,
  OrderItemQtyRow,
  OrderTotalRow,
} from './customers.types';

type SpendPageRow = Record<string, unknown> & { total_count: number };

@Injectable()
export class CustomersRepository extends ScopedRepository {
  constructor(@Inject(SUPABASE_CLIENT) supabase: SupabaseClient) {
    super(supabase);
  }

  async findAll(
    tenant: TenantContext,
    search?: string,
    page = 1,
    limit = 20,
    customFieldKeys: string[] = [],
    restrictToCustomerIds?: string[],
    sortBy: CustomerSortField = 'created_at',
    sortOrder: 'asc' | 'desc' = 'desc',
  ) {
    // total_spent is an aggregate over `orders`, not a `customers` column —
    // PostgREST can't ORDER BY it while also paginating with an exact total
    // count, so that one sort field is delegated to a dedicated DB-side
    // function that applies the exact same filters (tenant/soft-delete/
    // restrict/search) then sorts BEFORE paginating. See migration 236.
    // Requires a real tenant_id (the function's WHERE tenant_id = $1 returns
    // zero rows for NULL) — the cross-tenant superadmin caller (tenantId
    // null, see scopedQuery) falls through to the default path below, same
    // as it always has for every other sort field.
    if (sortBy === 'total_spent' && tenant.tenantId) {
      return this.findAllSortedBySpend(
        tenant,
        search,
        page,
        limit,
        customFieldKeys,
        restrictToCustomerIds,
        sortOrder,
      );
    }

    // total_spent isn't a real customers column — only reachable here for the
    // tenantId-less superadmin edge case above; falls back to the same
    // default ordering used when no sort is requested at all.
    const orderColumn = sortBy === 'total_spent' ? 'created_at' : sortBy;
    let query = this.scopedQuery('customers', tenant)
      .select(
        'id, full_name, phone, email, plate_number, visit_date, odometer, loyalty_points, is_active, custom_fields, created_at',
      )
      .is('deleted_at', null)
      .order(orderColumn, { ascending: sortOrder === 'asc' })
      .range((page - 1) * limit, page * limit - 1);

    // Row-count twin of the query above, `head: true` so Postgrest returns
    // only the Content-Range total and no rows. Built directly off
    // `.from()` (not scopedQuery(), which already calls `.select('*')`
    // once) because the count option can only be passed on a query's
    // first `.select()` call.
    let countQuery = this.supabase
      .from('customers')
      .select('id', { count: 'exact', head: true })
      .is('deleted_at', null);
    if (tenant.tenantId)
      countQuery = countQuery.eq('tenant_id', tenant.tenantId);

    // Customer Domain Phase 4 (Owner-approved) — BRANCH-scope visibility.
    // Applied here, not as a post-filter, so pagination/range stays correct.
    if (restrictToCustomerIds) {
      query = query.in('id', restrictToCustomerIds);
      countQuery = countQuery.in('id', restrictToCustomerIds);
    }

    if (search) {
      const escaped = search.replace(/[%,]/g, '');
      const conditions = [
        `full_name.ilike.%${escaped}%`,
        `phone.ilike.%${escaped}%`,
        ...customFieldKeys.map(
          (key) => `custom_fields->>${key}.ilike.%${escaped}%`,
        ),
      ];
      query = query.or(conditions.join(','));
      countQuery = countQuery.or(conditions.join(','));
    }

    const [{ data, error }, { count, error: countError }] = await Promise.all([
      query.returns<CustomerRow[]>(),
      countQuery,
    ]);
    if (error) throw error;
    if (countError) throw countError;

    const customers = data ?? [];
    const total = count ?? customers.length;
    if (customers.length === 0) return { data: customers, total };

    const ids = customers.map((c) => c.id);
    const { data: orders, error: ordersError } = await this.supabase
      .from('orders')
      .select('customer_id, total')
      .eq('tenant_id', tenant.tenantId)
      .eq('status', 'completed')
      .in('customer_id', ids)
      .returns<OrderTotalRow[]>();
    if (ordersError) throw ordersError;

    const statsByCustomer = new Map<
      string,
      { orders_count: number; total_spent: number }
    >();
    for (const order of orders ?? []) {
      const entry = statsByCustomer.get(order.customer_id) ?? {
        orders_count: 0,
        total_spent: 0,
      };
      entry.orders_count += 1;
      entry.total_spent += order.total ?? 0;
      statsByCustomer.set(order.customer_id, entry);
    }

    return {
      data: customers.map((customer) => ({
        ...customer,
        orders_count: statsByCustomer.get(customer.id)?.orders_count ?? 0,
        total_spent: statsByCustomer.get(customer.id)?.total_spent ?? 0,
      })),
      total,
    };
  }

  // total_spent sort path — delegates filtering+aggregation+sort+pagination
  // entirely to fn_customers_page_by_spend (migration 236) so the ORDER BY
  // happens in Postgres before the LIMIT/OFFSET, unlike findAll()'s default
  // path above (which can only paginate on real `customers` columns).
  private async findAllSortedBySpend(
    tenant: TenantContext,
    search: string | undefined,
    page: number,
    limit: number,
    customFieldKeys: string[],
    restrictToCustomerIds: string[] | undefined,
    sortOrder: 'asc' | 'desc',
  ) {
    const escapedSearch = search ? search.replace(/[%,]/g, '') : null;
    const spendRes = await this.supabase.rpc('fn_customers_page_by_spend', {
      p_tenant_id: tenant.tenantId,
      p_search: escapedSearch,
      p_custom_field_keys: customFieldKeys,
      p_restrict_ids: restrictToCustomerIds ?? null,
      p_ascending: sortOrder === 'asc',
      p_limit: limit,
      p_offset: (page - 1) * limit,
    });
    if (spendRes.error) throw spendRes.error;

    const rows: SpendPageRow[] = (spendRes.data as SpendPageRow[] | null) ?? [];
    const total = rows[0]?.total_count ?? 0;

    return {
      data: rows.map((row) => {
        const customer = { ...row };
        delete customer.total_count;
        return customer;
      }),
      total,
    };
  }

  async findById(tenant: TenantContext, id: string) {
    // maybeSingle(), not single() — single() throws a raw PGRST116 Postgrest error when 0 rows
    // match (e.g. a nonexistent or cross-tenant id), which bubbled up as an unhandled 500 instead
    // of letting CustomersService.findById's own `if (!customer) throw NotFoundException` run.
    const { data, error } = await this.scopedQuery('customers', tenant)
      .select('*')
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle<CustomerRow>();
    if (error) throw error;
    return data;
  }

  // T12 — matches on the normalised phone (last 9 digits), so 0551234567,
  // 551234567 and +966551234567 are the same customer. Falls back to an
  // exact match on the raw value when the input has no digits.
  async findByPhone(tenant: TenantContext, phone: string) {
    const normalized = normalizePhone(phone);
    let query = this.scopedQuery('customers', tenant)
      .select('id')
      .is('deleted_at', null);
    query = normalized
      ? query.eq('phone_normalized', normalized)
      : query.eq('phone', phone);
    const { data, error } = await query.limit(1).maybeSingle<IdRow>();
    if (error) throw error;
    return data;
  }

  async findByPhoneNormalized(tenant: TenantContext, normalized: string) {
    const { data, error } = await this.scopedQuery('customers', tenant)
      .select('*')
      .eq('phone_normalized', normalized)
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle<CustomerRow>();
    if (error) throw error;
    return data;
  }

  async findVehicleByPlate(tenant: TenantContext, plateNormalized: string) {
    const { data, error } = await this.scopedQuery('customer_vehicles', tenant)
      .select('*')
      .eq('plate_normalized', plateNormalized)
      .is('deleted_at', null)
      .maybeSingle<CustomerVehicleRow>();
    if (error) throw error;
    return data;
  }

  async listVehicles(tenant: TenantContext, customerId: string) {
    const { data, error } = await this.scopedQuery('customer_vehicles', tenant)
      .select('*')
      .eq('customer_id', customerId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .returns<CustomerVehicleRow[]>();
    if (error) throw error;
    return data ?? [];
  }

  async createVehicle(
    tenant: TenantContext,
    payload: {
      customer_id: string;
      plate: string;
      size?: string | null;
      model?: string | null;
      colour?: string | null;
    },
  ) {
    const { data, error } = await this.supabase
      .from('customer_vehicles')
      .insert({ ...payload, tenant_id: tenant.tenantId })
      .select()
      .single<CustomerVehicleRow>();
    if (error) throw error;
    return data;
  }

  async findVehicle(
    tenant: TenantContext,
    customerId: string,
    vehicleId: string,
  ) {
    const { data, error } = await this.scopedQuery('customer_vehicles', tenant)
      .select('*')
      .eq('id', vehicleId)
      .eq('customer_id', customerId)
      .is('deleted_at', null)
      .maybeSingle<CustomerVehicleRow>();
    if (error) throw error;
    return data;
  }

  // plate_normalized is re-derived by the trigger on UPDATE OF plate (255).
  async updateVehicle(
    tenant: TenantContext,
    id: string,
    payload: { plate?: string; size?: string | null },
  ) {
    const { data, error } = await this.supabase
      .from('customer_vehicles')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenant.tenantId)
      .is('deleted_at', null)
      .select()
      .single<CustomerVehicleRow>();
    if (error) throw error;
    return data;
  }

  async softDeleteVehicle(tenant: TenantContext, id: string) {
    const { error } = await this.supabase
      .from('customer_vehicles')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenant.tenantId);
    if (error) throw error;
  }

  async updateVehicleSize(tenant: TenantContext, id: string, size: string) {
    const { error } = await this.supabase
      .from('customer_vehicles')
      .update({ size, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenant.tenantId);
    if (error) throw error;
  }

  async countAll(tenant: TenantContext): Promise<number> {
    const { count, error } = await this.supabase
      .from('customers')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant.tenantId);
    if (error) throw error;
    return count ?? 0;
  }

  async create(tenant: TenantContext, payload: CreateCustomerDto) {
    const { data, error } = await this.supabase
      .from('customers')
      .insert({
        ...payload,
        tenant_id: tenant.tenantId,
        loyalty_points: 0,
        is_active: true,
      })
      .select()
      .single<CustomerRow>();
    if (error) throw error;
    return data;
  }

  async update(tenant: TenantContext, id: string, payload: UpdateCustomerDto) {
    const { data, error } = await this.supabase
      .from('customers')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenant.tenantId)
      .is('deleted_at', null)
      .select()
      .single<CustomerRow>();
    if (error) throw error;
    return data;
  }

  async softDelete(tenant: TenantContext, id: string) {
    const { error } = await this.supabase
      .from('customers')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenant.tenantId);
    if (error) throw error;
  }

  async getGlobalStats(
    tenant: TenantContext,
    range?: { from: string; to: string },
  ) {
    // Customers created inside the requested local-day range (tenant
    // timezone, the same day boundaries the reports use). Only when asked.
    let newInRange: number | undefined;
    if (range && tenant.tenantId) {
      const { data: tzRow } = await this.supabase
        .from('tenants')
        .select('timezone')
        .eq('id', tenant.tenantId)
        .maybeSingle();
      const tz = safeTimezone(
        (tzRow as { timezone?: string } | null)?.timezone,
      );
      const { count, error } = await this.supabase
        .from('customers')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenant.tenantId)
        .is('deleted_at', null)
        .gte('created_at', localDayBoundIso(range.from, 'start', tz))
        .lte('created_at', localDayBoundIso(range.to, 'end', tz));
      if (error) throw error;
      newInRange = count ?? 0;
    }

    const now = new Date();
    const startOfMonth = new Date(
      now.getFullYear(),
      now.getMonth(),
      1,
    ).toISOString();

    let totalQuery = this.supabase
      .from('customers')
      .select('id', { count: 'exact', head: true })
      .is('deleted_at', null);

    let monthQuery = this.supabase
      .from('customers')
      .select('id', { count: 'exact', head: true })
      .is('deleted_at', null)
      .gte('created_at', startOfMonth);

    // tenantId is null only for superadmin callers — intentional cross-tenant access
    if (tenant.tenantId) {
      totalQuery = totalQuery.eq('tenant_id', tenant.tenantId);
      monthQuery = monthQuery.eq('tenant_id', tenant.tenantId);
    }

    // DB-side SUM via fn_customer_loyalty_points_total — never fetches
    // customer rows to compute this, so it's unaffected by pagination and
    // scales the same way regardless of customer count. Only meaningful
    // per-tenant; superadmin (tenantId null) falls back to a direct
    // cross-tenant sum, matching how total/new_this_month behave for that
    // caller (no tenant filter at all).
    const loyaltyQuery = tenant.tenantId
      ? this.supabase.rpc('fn_customer_loyalty_points_total', {
          p_tenant_id: tenant.tenantId,
        })
      : this.supabase
          .from('customers')
          .select('loyalty_points')
          .is('deleted_at', null);

    const [
      { count: total, error: e1 },
      { count: newThisMonth, error: e2 },
      loyaltyResult,
    ] = await Promise.all([totalQuery, monthQuery, loyaltyQuery]);

    if (e1) throw e1;
    if (e2) throw e2;
    if (loyaltyResult.error) throw loyaltyResult.error;

    const totalLoyaltyPoints = tenant.tenantId
      ? Number(
          (loyaltyResult.data as { total_loyalty_points: number }[] | null)?.[0]
            ?.total_loyalty_points ?? 0,
        )
      : (
          (loyaltyResult.data as { loyalty_points: number }[] | null) ?? []
        ).reduce((sum, c) => sum + (c.loyalty_points ?? 0), 0);

    return {
      total: total ?? 0,
      new_this_month: newThisMonth ?? 0,
      ...(newInRange !== undefined && { new_in_range: newInRange }),
      total_loyalty_points: totalLoyaltyPoints,
    };
  }

  async getHistory(tenant: TenantContext, customerId: string, limit = 10) {
    const { data, error } = await this.supabase
      .from('orders')
      .select('id, total, payment_method, status, created_at')
      .eq('tenant_id', tenant.tenantId)
      .eq('customer_id', customerId)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(limit)
      .returns<OrderHistoryRow[]>();
    if (error) throw error;
    const orders = data ?? [];
    if (orders.length === 0) return [];

    // The customer screen shows how many items each order had.
    const { data: items, error: itemsError } = await this.supabase
      .from('order_items')
      .select('order_id, qty')
      .in(
        'order_id',
        orders.map((o) => o.id),
      )
      .is('deleted_at', null)
      .returns<OrderItemQtyRow[]>();
    if (itemsError) throw itemsError;
    const counts = new Map<string, number>();
    for (const row of items ?? []) {
      const id = row.order_id;
      counts.set(id, (counts.get(id) ?? 0) + Number(row.qty ?? 0));
    }
    return orders.map((o) => ({ ...o, items_count: counts.get(o.id) ?? 0 }));
  }

  // Customer Domain Phase 4 (Owner-approved) — reads the tenant's
  // customer_identity_scope directly (not via TenantsRepository/Service,
  // whose PROFILE_COLUMNS allowlist is a separate, broader concern outside
  // this phase's scope).
  //
  // Batch 1 Remediation 2 (Owner-approved) — genuine infrastructure errors
  // (network/timeout/malformed query) still propagate via `if (error) throw`
  // below, exactly as before; only the previously-unreachable-in-practice
  // "query succeeded but the value is somehow null/undefined/invalid"
  // fallback changed direction. It now resolves to 'branch' (the
  // restrictive state), matching this codebase's own established
  // fail-closed precedent (BranchAuthorizationService.branchExists() — a
  // failed lookup denies, it never grants). Resolving that fallback to
  // 'shared' would have silently widened a restricted actor's visibility
  // to the entire tenant the moment this branch was ever reached — the
  // exact "failure to determine scope must never widen visibility"
  // invariant this remediation exists to close.
  async getCustomerIdentityScope(
    tenantId: string,
  ): Promise<'shared' | 'branch'> {
    const { data, error } = await this.supabase
      .from('tenants')
      .select('customer_identity_scope')
      .eq('id', tenantId)
      .single<{ customer_identity_scope: string | null }>();
    if (error) throw error;
    const value = data?.customer_identity_scope;
    return value === 'shared' || value === 'branch' ? value : 'branch';
  }

  // Distinct customer ids with an established relationship to this branch —
  // used to scope findAll() under BRANCH visibility.
  async findRelatedCustomerIds(
    tenantId: string,
    branchId: string,
  ): Promise<string[]> {
    const { data, error } = await this.supabase
      .from('customer_branch_relationships')
      .select('customer_id')
      .eq('tenant_id', tenantId)
      .eq('branch_id', branchId)
      .returns<{ customer_id: string }[]>();
    if (error) throw error;
    return (data ?? []).map((r) => r.customer_id);
  }

  // Record-level equivalent for a single customer read under BRANCH
  // visibility — mirrors BranchAuthorizationService.authorizeRecordAccess's
  // Central-always-allowed/Restricted-must-match principle, adapted for a
  // many-valued relationship instead of a scalar record branch (see
  // CustomersService.findById for why authorizeRecordAccess itself isn't
  // called directly here).
  async hasRelationship(
    tenantId: string,
    customerId: string,
    branchId: string,
  ): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('customer_branch_relationships')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('customer_id', customerId)
      .eq('branch_id', branchId)
      .maybeSingle<IdRow>();
    if (error) throw error;
    return data !== null;
  }

  // Customer Domain Phase 3 (Owner-approved) — additive, never-deleted
  // customer<->branch relationship. A first-time pairing inserts a new row
  // with the given source; a repeat pairing only bumps last_seen_at,
  // deliberately NEVER overwriting the original source/first_seen_at —
  // a plain upsert() would clobber source on every repeat call since
  // Supabase's upsert applies the same payload to both the insert and
  // update branches, so this uses an explicit select-then-branch instead.
  async upsertRelationship(
    tenant: TenantContext,
    customerId: string,
    branchId: string,
    source: 'created' | 'transaction',
  ) {
    const { data: existing, error: findError } = await this.supabase
      .from('customer_branch_relationships')
      .select('id')
      .eq('tenant_id', tenant.tenantId)
      .eq('customer_id', customerId)
      .eq('branch_id', branchId)
      .maybeSingle<IdRow>();
    if (findError) throw findError;

    if (existing) {
      const { error } = await this.supabase
        .from('customer_branch_relationships')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('id', existing.id);
      if (error) throw error;
      return;
    }

    const { error } = await this.supabase
      .from('customer_branch_relationships')
      .insert({
        tenant_id: tenant.tenantId,
        customer_id: customerId,
        branch_id: branchId,
        source,
      });
    // A concurrent insert racing this one would trip the unique constraint —
    // that's fine, it means another call already established the exact same
    // relationship fact; nothing to do.
    if (error && !isUniqueViolation(error)) throw error;
  }

  async getStats(tenant: TenantContext, customerId: string) {
    const [countRes, aggRes, lastRes] = await Promise.all([
      this.supabase
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenant.tenantId)
        .eq('customer_id', customerId)
        .eq('status', 'completed'),
      this.supabase.rpc('customer_order_aggregates', {
        p_tenant_id: tenant.tenantId,
        p_customer_id: customerId,
      }),
      this.supabase
        .from('orders')
        .select('created_at')
        .eq('tenant_id', tenant.tenantId)
        .eq('customer_id', customerId)
        .eq('status', 'completed')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle<{ created_at: string }>(),
    ]);

    if (countRes.error) throw countRes.error;

    const orders_count = countRes.count ?? 0;
    // customer_order_aggregates is declared RETURNS TABLE, so PostgREST hands
    // back an array of rows ([{ total_spent }]), not a single object.
    type AggRow = { total_spent?: number | string | null };
    const aggData = aggRes.data as AggRow[] | AggRow | null;
    const aggRow = Array.isArray(aggData) ? aggData[0] : aggData;
    const total_spent = Number(aggRow?.total_spent ?? 0);
    const avg_order =
      orders_count > 0 ? Math.round(total_spent / orders_count) : 0;
    const last_order_at = lastRes.data?.created_at ?? null;

    return { orders_count, total_spent, avg_order, last_order_at };
  }
}
