import { BadRequestException, Injectable, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../../shared/supabase/supabase.module';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';
import { TenantContext } from '../../../core/tenant/tenant-context';
import { scopeToBranch } from '../../../core/tenant/branch-scope.util';
import { PaginationDto } from '../../../shared/dto/pagination.dto';
import { JournalEntriesQueryDto } from '../dto/journal-entries-query.dto';
import { PriceOverrideAuditQueryDto } from '../dto/price-override-audit-query.dto';
import { AssignBranchAccountingOwnerDto } from '../dto/assign-branch-accounting-owner.dto';

// Accounting Backend Phase 1 — read-only repository (one write:
// assignBranchAccountingOwner) exposing existing accounting truth.
// None of these tables have a deleted_at column (confirmed live), so
// ScopedRepository's scopedQuery()/unscopedQuery() helpers (which
// unconditionally filter .is('deleted_at', null)) cannot be reused here
// — every query below filters tenant_id directly instead, using the
// same plain service-role client every other read-only repository in
// this codebase already uses (per the approved RLS decision: no one-off
// pooled reads for this module).
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

@Injectable()
export class AccountingRepository extends ScopedRepository {
  constructor(@Inject(SUPABASE_CLIENT) supabase: SupabaseClient) {
    super(supabase);
  }

  private readonly JOURNAL_ENTRY_SELECT = `
    id, reference, description, source_module, source_entity_type,
    source_entity_id, status, posting_date, fiscal_period_id,
    reversal_of_id, requires_cogs_reconciliation, created_by, created_at,
    posted_at, reversed_at
  `;

  // Branch isolation (D9): the ledger of a branch is the set of journal entries posted into the books of that
  // branch's accounting owner(s) (book -> owner -> branch; every branch has its own owner + default book).
  // Owners without a branch (Central accounting) belong to the MAIN branch. Returns null when isolation is off
  // (no restriction). An empty result is returned as [NIL_UUID] so .in() never matches.
  async resolveBranchBookIds(tenant: TenantContext): Promise<string[] | null> {
    if (!tenant.isolated || !tenant.branchId) return null;
    const { data: branch } = await this.supabase
      .from('branches')
      .select('is_main')
      .eq('tenant_id', tenant.tenantId)
      .eq('id', tenant.branchId)
      .maybeSingle();
    let owners = this.supabase
      .from('accounting_owners')
      .select('id')
      .eq('tenant_id', tenant.tenantId);
    owners = branch?.is_main
      ? owners.or(`branch_id.eq.${tenant.branchId},branch_id.is.null`)
      : owners.eq('branch_id', tenant.branchId);
    const { data: ownerRows, error: ownerError } = await owners;
    if (ownerError) throw ownerError;
    const ownerIds = (ownerRows ?? []).map((o) => o.id as string);
    if (ownerIds.length === 0) return [NIL_UUID];
    const { data: bookRows, error: bookError } = await this.supabase
      .from('accounting_books')
      .select('id')
      .eq('tenant_id', tenant.tenantId)
      .in('accounting_owner_id', ownerIds);
    if (bookError) throw bookError;
    const ids = (bookRows ?? []).map((b) => b.id as string);
    return ids.length ? ids : [NIL_UUID];
  }

  // orders.branch_id is the only reachable branch context for a
  // sales-sourced entry — journal_entries itself has no branch_id column
  // (confirmed live). Resolved via a subquery on source_entity_id rather
  // than a join, since source_entity_type varies by source_module and a
  // real join would need to change target table per row.
  private async resolveOrderBranchIds(
    tenantId: string,
    branchId: string,
  ): Promise<string[]> {
    const { data, error } = await this.supabase
      .from('orders')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('branch_id', branchId);
    if (error || !data) return [];
    return data.map((row) => row.id as string);
  }

  async findJournalEntries(
    tenant: TenantContext,
    query: JournalEntriesQueryDto,
  ) {
    const amountMin = query.amount_min;
    const amountMax = query.amount_max;
    if (
      (amountMin !== undefined && amountMin < 0) ||
      (amountMax !== undefined && amountMax < 0)
    ) {
      throw new BadRequestException(
        'amount_min and amount_max must not be negative',
      );
    }
    if (
      amountMin !== undefined &&
      amountMax !== undefined &&
      amountMin > amountMax
    ) {
      throw new BadRequestException(
        'amount_min must not be greater than amount_max',
      );
    }

    // account/amount are line-level conditions: they are applied in the
    // database as an inner-joined filter on journal_lines, so total, page
    // count and the rows of every page all describe the same filtered set.
    // (They used to be a post-filter on the already-paginated page.)
    const lineFilter =
      !!query.account_id || amountMin !== undefined || amountMax !== undefined;

    const bookIds = await this.resolveBranchBookIds(tenant);
    const pagination = new PaginationDto(query.page, query.per_page);
    let builder = this.supabase
      .from('journal_entries')
      .select(
        lineFilter
          ? `${this.JOURNAL_ENTRY_SELECT}, journal_lines!inner(id)`
          : this.JOURNAL_ENTRY_SELECT,
        { count: 'exact' },
      )
      .eq('tenant_id', tenant.tenantId);
    if (bookIds) builder = builder.in('accounting_book_id', bookIds);

    if (lineFilter) {
      if (query.account_id)
        builder = builder.eq('journal_lines.account_id', query.account_id);
      // A line's amount is whichever side is non-zero.
      if (amountMin !== undefined)
        builder = builder.or(
          `debit_amount.gte.${amountMin},credit_amount.gte.${amountMin}`,
          { referencedTable: 'journal_lines' },
        );
      if (amountMax !== undefined) {
        builder = builder
          .lte('journal_lines.debit_amount', amountMax)
          .lte('journal_lines.credit_amount', amountMax);
      }
    }

    if (query.date_from) builder = builder.gte('posting_date', query.date_from);
    if (query.date_to) builder = builder.lte('posting_date', query.date_to);
    if (query.fiscal_period_id)
      builder = builder.eq('fiscal_period_id', query.fiscal_period_id);
    // 'manual' = entries with no source module (hand-written entries).
    if (query.source_module === 'manual')
      builder = builder.is('source_module', null);
    else if (query.source_module)
      builder = builder.eq('source_module', query.source_module);
    if (query.status) builder = builder.eq('status', query.status);
    if (query.created_by) builder = builder.eq('created_by', query.created_by);
    if (query.requires_cogs_reconciliation !== undefined) {
      builder = builder.eq(
        'requires_cogs_reconciliation',
        query.requires_cogs_reconciliation,
      );
    }
    if (query.branch_id) {
      // Only sales-sourced entries are branch-filterable today (the only
      // source_module that exists) - resolved via the order's own branch,
      // never assumed for any other future source_module.
      const orderIds = await this.resolveOrderBranchIds(
        tenant.tenantId,
        query.branch_id,
      );
      builder = builder.in(
        'source_entity_id',
        orderIds.length ? orderIds : ['00000000-0000-0000-0000-000000000000'],
      );
    }

    const [from, to] = pagination.range;
    const { data, error, count } = await builder
      .order('posting_date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(from, to);
    if (error) throw error;

    const rows = ((data ?? []) as unknown as Record<string, unknown>[]).map(
      (r) => {
        const entry = { ...r };
        delete entry.journal_lines;
        return entry;
      },
    );

    return {
      data: rows,
      total: count ?? 0,
      page: pagination.page,
      perPage: pagination.perPage,
    };
  }

  async findJournalEntryDetail(tenant: TenantContext, id: string) {
    const bookIds = await this.resolveBranchBookIds(tenant);
    let entryQuery = this.supabase
      .from('journal_entries')
      .select(this.JOURNAL_ENTRY_SELECT)
      .eq('tenant_id', tenant.tenantId)
      .eq('id', id);
    if (bookIds) entryQuery = entryQuery.in('accounting_book_id', bookIds);
    const { data: entry, error } = await entryQuery.maybeSingle();
    if (error) throw error;
    if (!entry) return null;

    const { data: lines } = await this.supabase
      .from('journal_lines')
      .select(
        'id, line_number, account_id, debit_amount, credit_amount, description',
      )
      .eq('journal_entry_id', id)
      .order('line_number', { ascending: true });

    let order: unknown = null;
    let priceOverrideAudits: unknown[] = [];
    if (
      entry.source_module === 'sales' &&
      entry.source_entity_type === 'order'
    ) {
      const { data: orderRow } = await this.supabase
        .from('orders')
        .select(
          'id, invoice_no, branch_id, payment_method, subtotal, discount, tax, total, cash_amount, card_amount, customer_id, status',
        )
        .eq('id', entry.source_entity_id)
        .maybeSingle();
      order = orderRow ?? null;

      const { data: audits } = await this.supabase
        .from('price_override_audit')
        .select(
          'id, order_item_id, official_unit_price, approved_unit_price, difference_amount, difference_percent, direction, reason',
        )
        .eq('order_id', entry.source_entity_id);
      priceOverrideAudits = audits ?? [];
    }

    let reversalEntry: unknown = null;
    if (entry.reversal_of_id === null) {
      const { data: rev } = await this.supabase
        .from('journal_entries')
        .select('id, reference, status, created_at')
        .eq('reversal_of_id', id)
        .maybeSingle();
      reversalEntry = rev ?? null;
    }

    return {
      ...entry,
      lines: lines ?? [],
      order,
      priceOverrideAudits,
      reversalEntry,
    };
  }

  async findPriceOverrideAudits(
    tenant: TenantContext,
    query: PriceOverrideAuditQueryDto,
  ) {
    const pagination = new PaginationDto(query.page, query.per_page);
    let builder = this.supabase
      .from('price_override_audit')
      .select(
        'id, branch_id, order_id, order_item_id, actor_id, actor_role_id, actor_role_name_snapshot, item_id, official_unit_price, approved_unit_price, difference_amount, difference_percent, direction, reason, created_at',
        { count: 'exact' },
      )
      .eq('tenant_id', tenant.tenantId);
    builder = scopeToBranch(builder, tenant);

    if (query.date_from) builder = builder.gte('created_at', query.date_from);
    if (query.date_to) builder = builder.lte('created_at', query.date_to);
    if (query.branch_id) builder = builder.eq('branch_id', query.branch_id);
    if (query.order_id) {
      // Accepts the order UUID or its invoice number (INV-xxxxxx).
      let orderId = query.order_id;
      if (!UUID_RE.test(orderId)) {
        const { data: ord } = await this.supabase
          .from('orders')
          .select('id')
          .eq('tenant_id', tenant.tenantId)
          .eq('invoice_no', orderId)
          .maybeSingle();
        orderId = (ord?.id as string | undefined) ?? NIL_UUID;
      }
      builder = builder.eq('order_id', orderId);
    }
    if (query.item_id) builder = builder.eq('item_id', query.item_id);
    if (query.actor_id) builder = builder.eq('actor_id', query.actor_id);
    if (query.actor_role_id)
      builder = builder.eq('actor_role_id', query.actor_role_id);
    if (query.direction) builder = builder.eq('direction', query.direction);
    if (query.difference_percent_min !== undefined)
      builder = builder.gte('difference_percent', query.difference_percent_min);
    if (query.difference_percent_max !== undefined)
      builder = builder.lte('difference_percent', query.difference_percent_max);
    if (query.reason) builder = builder.ilike('reason', `%${query.reason}%`);

    const [from, to] = pagination.range;
    const { data, error, count } = await builder
      .order('created_at', { ascending: false })
      .range(from, to);
    if (error) throw error;

    return {
      data: data ?? [],
      total: count ?? 0,
      page: pagination.page,
      perPage: pagination.perPage,
    };
  }

  async findPriceOverrideAuditDetail(tenant: TenantContext, id: string) {
    let auditQuery = this.supabase
      .from('price_override_audit')
      .select(
        'id, tenant_id, branch_id, order_id, order_item_id, actor_id, actor_role_id, actor_role_name_snapshot, item_id, official_unit_price, approved_unit_price, difference_amount, difference_percent, direction, reason, effective_policy_snapshot, created_at',
      )
      .eq('tenant_id', tenant.tenantId)
      .eq('id', id);
    auditQuery = scopeToBranch(auditQuery, tenant);
    const { data, error } = await auditQuery.maybeSingle();
    if (error) throw error;
    if (!data) return null;

    const { data: journal } = await this.supabase
      .from('journal_entries')
      .select('id, status, posting_date')
      .eq('source_module', 'sales')
      .eq('source_entity_type', 'order')
      .eq('source_entity_id', data.order_id)
      .is('reversal_of_id', null)
      .maybeSingle();

    return { ...data, journalEntry: journal ?? null };
  }

  async findFiscalPeriods(tenant: TenantContext) {
    const { data, error } = await this.supabase
      .from('fiscal_periods')
      .select('id, fiscal_year_id, period_number, start_date, end_date, status')
      .eq('tenant_id', tenant.tenantId)
      .order('start_date', { ascending: false });
    if (error) throw error;
    return data ?? [];
  }

  async findAccountingOwners(tenant: TenantContext) {
    let query = this.supabase
      .from('accounting_owners')
      .select('id, branch_id, owner_type_code, name, status, created_at')
      .eq('tenant_id', tenant.tenantId)
      .order('created_at', { ascending: true });
    query = scopeToBranch(query, tenant);
    const { data, error } = await query;
    if (error) throw error;
    return data ?? [];
  }

  async findBranchAssignments(tenant: TenantContext) {
    let query = this.supabase
      .from('branch_accounting_assignments')
      .select(
        'id, branch_id, accounting_owner_id, effective_from, effective_to, reason, created_at',
      )
      .eq('tenant_id', tenant.tenantId)
      .order('effective_from', { ascending: false });
    query = scopeToBranch(query, tenant);
    const { data, error } = await query;
    if (error) throw error;
    return data ?? [];
  }

  // The one write in this module — reuses the exact same trigger-guarded
  // INSERT AccountingBootstrapService already performs, per the approved
  // design (no new logic, a second sanctioned caller of an existing
  // write path).
  async assignBranchAccountingOwner(
    tenant: TenantContext,
    dto: AssignBranchAccountingOwnerDto,
    createdBy: string,
  ) {
    const { data, error } = await this.supabase
      .from('branch_accounting_assignments')
      .insert({
        tenant_id: tenant.tenantId,
        branch_id: dto.branch_id,
        accounting_owner_id: dto.accounting_owner_id,
        effective_from: dto.effective_from,
        reason: dto.reason ?? null,
        created_by: createdBy,
      })
      .select(
        'id, branch_id, accounting_owner_id, effective_from, effective_to, reason, created_at',
      )
      .single();
    if (error) throw error;
    return data;
  }

  // Account balances (debit/credit totals over posted + reversed entries) of the request's branch ledger, or of the
  // whole tenant when isolation is off. Read-only aggregate (fn_trial_balance, migration 301).
  async getTrialBalance(tenant: TenantContext) {
    const bookIds = await this.resolveBranchBookIds(tenant);
    const { data: totals, error } = await this.supabase.rpc(
      'fn_trial_balance',
      {
        p_tenant_id: tenant.tenantId,
        p_book_ids: bookIds,
      },
    );
    if (error) throw error;
    const byAccount = new Map<string, { debit: number; credit: number }>();
    for (const row of (totals ?? []) as {
      account_id: string;
      debit_total: number | string;
      credit_total: number | string;
    }[]) {
      byAccount.set(row.account_id, {
        debit: Number(row.debit_total),
        credit: Number(row.credit_total),
      });
    }
    const { data: accounts, error: accError } = await this.supabase
      .from('accounts')
      .select('id, code, name, account_type, normal_balance')
      .eq('tenant_id', tenant.tenantId)
      .order('code', { ascending: true });
    if (accError) throw accError;
    return (accounts ?? [])
      .filter((a) => byAccount.has(a.id as string))
      .map((a) => {
        const t = byAccount.get(a.id as string)!;
        const net = t.debit - t.credit;
        return {
          account_id: a.id,
          code: a.code,
          name: a.name,
          account_type: a.account_type,
          normal_balance: a.normal_balance,
          debit_total: t.debit,
          credit_total: t.credit,
          balance: a.normal_balance === 'debit' ? net : -net,
        };
      });
  }

  async findChartOfAccounts(tenant: TenantContext) {
    const { data, error } = await this.supabase
      .from('accounts')
      .select(
        'id, parent_account_id, code, name, account_type, normal_balance, is_posting_account, is_active',
      )
      .eq('tenant_id', tenant.tenantId)
      .order('code', { ascending: true });
    if (error) throw error;

    const { data: roleAssignments } = await this.supabase
      .from('account_role_assignments')
      .select('account_id, role_code')
      .eq('tenant_id', tenant.tenantId);

    const rolesByAccount = new Map<string, string[]>();
    for (const row of roleAssignments ?? []) {
      const list = rolesByAccount.get(row.account_id as string) ?? [];
      list.push(row.role_code as string);
      rolesByAccount.set(row.account_id as string, list);
    }

    return (data ?? []).map((account) => ({
      ...account,
      roleCodes: rolesByAccount.get(account.id as string) ?? [],
    }));
  }

  // Command Center — pure SUM/COUNT over already-posted journal truth.
  // No financial value is computed here that the posting engine didn't
  // already decide; this only aggregates what fn_post_sales_order already
  // wrote.
  async getCommandCenterSummary(tenant: TenantContext) {
    const bookIds = await this.resolveBranchBookIds(tenant);
    const [
      revenueLines,
      cashBankLines,
      arLines,
      taxLines,
      cogsLines,
      reconciliationCount,
      ownersCount,
      branchesTotal,
      assignedBranchesCount,
    ] = await Promise.all([
      this.sumLinesByRole(tenant, 'sales_revenue', 'credit', bookIds),
      this.sumLinesByRoles(
        tenant,
        ['default_cash', 'default_bank'],
        'debit',
        bookIds,
      ),
      this.sumLinesByRole(tenant, 'accounts_receivable', 'debit', bookIds),
      this.sumLinesByRole(tenant, 'tax_payable', 'credit', bookIds),
      this.sumLinesByRole(tenant, 'cogs', 'debit', bookIds),
      (() => {
        let q = this.supabase
          .from('journal_entries')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenant.tenantId)
          .eq('requires_cogs_reconciliation', true);
        if (bookIds) q = q.in('accounting_book_id', bookIds);
        return q;
      })(),
      (() => {
        let q = this.supabase
          .from('accounting_owners')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenant.tenantId);
        q = scopeToBranch(q, tenant);
        return q;
      })(),
      (() => {
        let q = this.supabase
          .from('branches')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenant.tenantId)
          .eq('is_active', true)
          .is('deleted_at', null);
        if (tenant.isolated && tenant.branchId) q = q.eq('id', tenant.branchId);
        return q;
      })(),
      (() => {
        let q = this.supabase
          .from('branch_accounting_assignments')
          .select('branch_id', { count: 'exact', head: true })
          .eq('tenant_id', tenant.tenantId)
          .is('effective_to', null);
        q = scopeToBranch(q, tenant);
        return q;
      })(),
    ]);

    return {
      revenue: revenueLines,
      cashAndBank: cashBankLines,
      accountsReceivable: arLines,
      taxLiability: taxLines,
      cogs: cogsLines,
      grossProfit: revenueLines - cogsLines,
      reconciliationExceptions: reconciliationCount.count ?? 0,
      tenantsWithAccountingOwner: (ownersCount.count ?? 0) > 0 ? 1 : 0,
      totalBranches: branchesTotal.count ?? 0,
      branchesAssigned: assignedBranchesCount.count ?? 0,
    };
  }

  private async sumLinesByRole(
    tenant: TenantContext,
    roleCode: string,
    side: 'debit' | 'credit',
    bookIds: string[] | null = null,
  ): Promise<number> {
    return this.sumLinesByRoles(tenant, [roleCode], side, bookIds);
  }

  private async sumLinesByRoles(
    tenant: TenantContext,
    roleCodes: string[],
    side: 'debit' | 'credit',
    bookIds: string[] | null = null,
  ): Promise<number> {
    const { data: roles } = await this.supabase
      .from('account_role_assignments')
      .select('account_id')
      .eq('tenant_id', tenant.tenantId)
      .in('role_code', roleCodes);
    const accountIds = (roles ?? []).map((r) => r.account_id as string);
    if (accountIds.length === 0) return 0;

    const column = side === 'debit' ? 'debit_amount' : 'credit_amount';
    const { data: lines } = await this.supabase
      .from('journal_lines')
      .select(`${column}, journal_entry_id`)
      .eq('tenant_id', tenant.tenantId)
      .in('account_id', accountIds);

    // Only lines belonging to a posted entry count toward the summary —
    // filtered via the entries already scoped to this tenant/status,
    // matching the "only already-posted truth" constraint.
    let postedQuery = this.supabase
      .from('journal_entries')
      .select('id')
      .eq('tenant_id', tenant.tenantId)
      .eq('status', 'posted');
    if (bookIds) postedQuery = postedQuery.in('accounting_book_id', bookIds);
    const entryIds = new Set(
      (await postedQuery).data?.map((e) => e.id as string) ?? [],
    );

    return (lines ?? [])
      .filter((l) => entryIds.has(l.journal_entry_id as string))
      .reduce((sum, l) => sum + Number(l[column]), 0);
  }
}
