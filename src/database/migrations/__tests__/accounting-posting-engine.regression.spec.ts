/**
 * H02 — Accounting SQL Posting Engine Regression Suite.
 *
 * Covers fn_post_journal_entry, fn_reverse_journal_entry,
 * fn_post_sales_order, fn_reverse_sales_order. Runs directly against the
 * real shared Supabase project via the service-role client — there is no
 * isolated test database in this environment (same convention as every
 * other `*.regression.spec.ts` file in this folder, e.g.
 * transfer-lifecycle.regression.spec.ts). Not wired into CI (api.yml only
 * runs `npm run build`) — run deliberately via `npm test` when this area
 * is touched again.
 *
 * Fixture strategy: reuses the existing, fully-provisioned demo tenant
 * (9bcd3369-...) for every scenario except #24, which needs a tenant
 * deliberately missing one account role — constructing that against the
 * demo tenant would mean removing a real role assignment other features
 * (including this session's own Accounting UI) depend on, so a small,
 * fully self-contained throwaway tenant is created and soft-deleted
 * instead (tenants/accounting_owners/accounting_books/
 * account_role_assignments carry no guard trigger — confirmed by reading
 * every relevant migration before writing this file).
 *
 * DEFERRED — scenario #6 (posting into a CLOSED fiscal period): every
 * fiscal_periods row in the live database is currently 'open' (verified
 * live before writing this file), and fiscal_periods/fiscal_years are
 * guarded append-only records (migration 179 — DELETE always blocked,
 * UPDATE blocked for every column except `status`). The only two ways to
 * construct this scenario are (a) toggle the demo tenant's real,
 * currently-open period covering today to 'closed' and back — a genuine,
 * crash-unsafe mutation of live production calendar data with no DELETE
 * fallback if the test process dies mid-run, or (b) permanently generate
 * a whole new fiscal year (1 year + 12 period rows, forever, since none
 * of them can ever be deleted) on the demo tenant purely to get one
 * closeable period. Per explicit owner decision (H02 implementation
 * round), this scenario is deferred rather than accepted under either
 * risk — to be revisited as its own small, separately-approved design
 * decision.
 *
 * Immutable leftovers this suite WILL create (disclosed here, not
 * hidden): every journal entry actually POSTED by a test (as opposed to
 * one left in 'draft' and deleted) becomes permanently undeletable
 * (migration 182 guard trigger — only 'draft' entries can be deleted).
 * Any stock_movements row inserted for the COGS test is also permanently
 * undeletable (documented project-wide, same as
 * transfer-lifecycle.regression.spec.ts's own identical leftover). The
 * one branch_accounting_assignments row created for the throwaway
 * tenant (#24) is append-only (migration 178) and is left in place on
 * that throwaway (soft-deleted) tenant — harmless, since the tenant
 * itself is marked deleted.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import * as dotenv from 'dotenv';
dotenv.config();

const TEST_TENANT_ID = '9bcd3369-d664-47c8-b297-3bc9b429aacf'; // Sefay Demo — used throughout this session's live verifications

function uniqueRef(label: string): string {
  return `H02-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe('accounting posting engine regression (fn_post_journal_entry, fn_reverse_journal_entry, fn_post_sales_order, fn_reverse_sales_order)', () => {
  let supabase: SupabaseClient;

  // Demo tenant's already-provisioned accounting setup (read-only lookups,
  // nothing here is created or mutated).
  let accountingOwnerId: string;
  let accountingBookId: string;
  let branchId: string;
  let openFiscalPeriodId: string;
  let roleAccount: Record<string, string>; // role_code -> account_id
  let trackedItemId: string; // has_inventory = true
  let serviceItemId: string; // has_inventory = false
  let warehouseId: string;

  // Fixtures this suite creates, tracked for cleanup.
  const draftEntriesToDelete: string[] = []; // entries that never got posted — safe to delete
  const ordersToDelete: string[] = []; // order ids (order_items cascade-deleted manually)
  const branchesToSoftDelete: string[] = []; // throwaway branches (soft delete via deleted_at)
  const postedEntryIds: string[] = []; // disclosed, never deleted (immutable once posted)
  const stockMovementIds: string[] = []; // disclosed, never deleted (immutable ledger)

  // A second, fully self-contained throwaway tenant for scenario #24
  // (missing account role) — see file header for why.
  let throwawayTenantId: string | null = null;

  beforeAll(async () => {
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    );

    const { data: owner } = await supabase
      .from('accounting_owners')
      .select('id')
      .eq('tenant_id', TEST_TENANT_ID)
      .limit(1)
      .single();
    accountingOwnerId = owner.id;

    const { data: book } = await supabase
      .from('accounting_books')
      .select('id')
      .eq('tenant_id', TEST_TENANT_ID)
      .eq('accounting_owner_id', accountingOwnerId)
      .eq('is_default', true)
      .single();
    accountingBookId = book.id;

    const { data: branch } = await supabase
      .from('branches')
      .select('id')
      .eq('tenant_id', TEST_TENANT_ID)
      .eq('is_active', true)
      .is('deleted_at', null)
      .limit(1)
      .single();
    branchId = branch.id;

    const today = new Date().toISOString().slice(0, 10);
    const { data: period } = await supabase
      .from('fiscal_periods')
      .select('id, start_date, end_date, status')
      .eq('tenant_id', TEST_TENANT_ID)
      .lte('start_date', today)
      .gt('end_date', today)
      .single();
    openFiscalPeriodId = period.id;
    expect(period.status).toBe('open'); // sanity: our whole "happy path" premise depends on this

    const { data: roles } = await supabase
      .from('account_role_assignments')
      .select('role_code, account_id')
      .eq('tenant_id', TEST_TENANT_ID);
    roleAccount = Object.fromEntries(
      (roles ?? []).map((r: { role_code: string; account_id: string }) => [
        r.role_code,
        r.account_id,
      ]),
    );
    for (const required of [
      'sales_revenue',
      'default_cash',
      'default_bank',
      'accounts_receivable',
      'tax_payable',
      'cogs',
      'inventory_asset',
    ]) {
      expect(roleAccount[required]).toBeTruthy();
    }

    const { data: trackedItem } = await supabase
      .from('items')
      .select('id')
      .eq('tenant_id', TEST_TENANT_ID)
      .eq('has_inventory', true)
      .eq('is_active', true)
      .limit(1)
      .single();
    trackedItemId = trackedItem.id;

    const { data: serviceItem } = await supabase
      .from('items')
      .select('id')
      .eq('tenant_id', TEST_TENANT_ID)
      .eq('has_inventory', false)
      .eq('is_active', true)
      .limit(1)
      .single();
    serviceItemId = serviceItem.id;

    const { data: wh } = await supabase
      .from('warehouses')
      .select('id')
      .eq('tenant_id', TEST_TENANT_ID)
      .limit(1)
      .single();
    warehouseId = wh.id;
  }, 30_000);

  afterAll(async () => {
    for (const id of draftEntriesToDelete) {
      await supabase.from('journal_lines').delete().eq('journal_entry_id', id);
      await supabase.from('journal_entries').delete().eq('id', id);
    }
    for (const id of ordersToDelete) {
      await supabase.from('order_items').delete().eq('order_id', id);
      await supabase.from('orders').delete().eq('id', id);
    }
    for (const id of branchesToSoftDelete) {
      await supabase
        .from('branches')
        .update({ deleted_at: new Date().toISOString(), is_active: false })
        .eq('id', id);
    }
    if (throwawayTenantId) {
      await supabase
        .from('tenants')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', throwawayTenantId);
    }
    // postedEntryIds / stockMovementIds: intentionally left. Both are
    // permanently immutable by DB-level guard/design (see file header) —
    // not a leak, disclosed here and in the final implementation report.
  }, 30_000);

  // ---- helpers ---------------------------------------------------------

  async function insertDraftEntry(
    tenantId: string,
    bookId: string,
    postingDate: string,
    lines: { account_id: string; debit: number; credit: number }[],
  ): Promise<string> {
    const { data: entry, error } = await supabase
      .from('journal_entries')
      .insert({
        tenant_id: tenantId,
        accounting_book_id: bookId,
        posting_date: postingDate,
        reference: uniqueRef('entry'),
        description: 'H02 regression fixture',
        status: 'draft',
      })
      .select('id')
      .single();
    if (error) throw error;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const { error: lineErr } = await supabase.from('journal_lines').insert({
        tenant_id: tenantId,
        journal_entry_id: entry.id,
        line_number: i + 1,
        account_id: l.account_id,
        debit_amount: l.debit,
        credit_amount: l.credit,
      });
      if (lineErr) throw lineErr;
    }
    return entry.id;
  }

  async function createOrder(
    overrides: Record<string, unknown>,
  ): Promise<string> {
    const base = {
      tenant_id: TEST_TENANT_ID,
      branch_id: branchId,
      status: 'completed',
      subtotal: 100,
      discount: 0,
      tax: 0,
      total: 100,
      payment_method: 'cash',
      held: false,
      sale_attempt_id: randomUUID(), // uuid column — confirmed via information_schema before fixing this
    };
    const { data, error } = await supabase
      .from('orders')
      .insert({ ...base, ...overrides })
      .select('id')
      .single();
    if (error) throw error;
    ordersToDelete.push(data.id);
    return data.id;
  }

  async function addOrderItem(
    orderId: string,
    itemId: string,
    qty: number,
    price: number,
  ) {
    const { error } = await supabase.from('order_items').insert({
      order_id: orderId,
      item_id: itemId,
      item_name: 'H02 regression item',
      qty,
      price,
      total_price: qty * price,
    });
    if (error) throw error;
  }

  async function recordSaleStockMovement(
    orderId: string,
    itemId: string,
    qty: number,
    unitCost: number,
  ) {
    const { data, error } = await supabase
      .from('stock_movements')
      .insert({
        tenant_id: TEST_TENANT_ID,
        warehouse_id: warehouseId,
        item_id: itemId,
        movement_type: 'sale',
        direction: 'out',
        quantity: qty,
        unit_cost: unitCost,
        total_cost: qty * unitCost,
        reference_type: 'order',
        reference_id: orderId,
        occurred_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    if (error) throw error;
    stockMovementIds.push(data.id);
  }

  async function getEntry(id: string) {
    const { data } = await supabase
      .from('journal_entries')
      .select('*')
      .eq('id', id)
      .single();
    return data;
  }

  async function getLines(entryId: string) {
    const { data } = await supabase
      .from('journal_lines')
      .select('*')
      .eq('journal_entry_id', entryId)
      .order('line_number');
    return data ?? [];
  }

  // ======================================================================
  // Group A — fn_post_journal_entry / fn_reverse_journal_entry
  // ======================================================================

  it('#1 balanced journal posts successfully', async () => {
    const entryId = await insertDraftEntry(
      TEST_TENANT_ID,
      accountingBookId,
      new Date().toISOString().slice(0, 10),
      [
        { account_id: roleAccount.default_cash, debit: 50, credit: 0 },
        { account_id: roleAccount.sales_revenue, debit: 0, credit: 50 },
      ],
    );
    const { data, error } = await supabase.rpc('fn_post_journal_entry', {
      p_tenant_id: TEST_TENANT_ID,
      p_entry_id: entryId,
      p_posted_by: null,
    });
    expect(error).toBeNull();
    expect(data).toBe(entryId);
    const entry = await getEntry(entryId);
    expect(entry.status).toBe('posted');
    postedEntryIds.push(entryId);
  }, 30_000);

  it('#2 unbalanced entry is rejected and stays draft', async () => {
    const entryId = await insertDraftEntry(
      TEST_TENANT_ID,
      accountingBookId,
      new Date().toISOString().slice(0, 10),
      [
        { account_id: roleAccount.default_cash, debit: 50, credit: 0 },
        { account_id: roleAccount.sales_revenue, debit: 0, credit: 40 },
      ],
    );
    const { error } = await supabase.rpc('fn_post_journal_entry', {
      p_tenant_id: TEST_TENANT_ID,
      p_entry_id: entryId,
      p_posted_by: null,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/not balanced/);
    const entry = await getEntry(entryId);
    expect(entry.status).toBe('draft');
    draftEntriesToDelete.push(entryId);
  }, 30_000);

  it('#3 fewer than 2 lines is rejected', async () => {
    const entryId = await insertDraftEntry(
      TEST_TENANT_ID,
      accountingBookId,
      new Date().toISOString().slice(0, 10),
      [{ account_id: roleAccount.default_cash, debit: 50, credit: 0 }],
    );
    const { error } = await supabase.rpc('fn_post_journal_entry', {
      p_tenant_id: TEST_TENANT_ID,
      p_entry_id: entryId,
      p_posted_by: null,
    });
    expect(error?.message).toMatch(/fewer than 2 lines/);
    draftEntriesToDelete.push(entryId);
  }, 30_000);

  it('#4 invalid (non-posting) account is rejected', async () => {
    const { data: headerAccount } = await supabase
      .from('accounts')
      .select('id')
      .eq('tenant_id', TEST_TENANT_ID)
      .eq('is_posting_account', false)
      .limit(1)
      .maybeSingle();
    if (!headerAccount) {
      // No non-posting account exists on this tenant to exercise this
      // path — skip rather than fabricate one (would mutate the real
      // chart of accounts).
      return;
    }
    const entryId = await insertDraftEntry(
      TEST_TENANT_ID,
      accountingBookId,
      new Date().toISOString().slice(0, 10),
      [
        { account_id: headerAccount.id, debit: 50, credit: 0 },
        { account_id: roleAccount.sales_revenue, debit: 0, credit: 50 },
      ],
    );
    const { error } = await supabase.rpc('fn_post_journal_entry', {
      p_tenant_id: TEST_TENANT_ID,
      p_entry_id: entryId,
      p_posted_by: null,
    });
    expect(error?.message).toMatch(/invalid, inactive, or non-posting account/);
    draftEntriesToDelete.push(entryId);
  }, 30_000);

  it('#5 posting date outside any fiscal period is rejected', async () => {
    const entryId = await insertDraftEntry(
      TEST_TENANT_ID,
      accountingBookId,
      '2099-01-15', // far outside any generated fiscal period
      [
        { account_id: roleAccount.default_cash, debit: 50, credit: 0 },
        { account_id: roleAccount.sales_revenue, debit: 0, credit: 50 },
      ],
    );
    const { error } = await supabase.rpc('fn_post_journal_entry', {
      p_tenant_id: TEST_TENANT_ID,
      p_entry_id: entryId,
      p_posted_by: null,
    });
    expect(error?.message).toMatch(/No fiscal period covers posting date/);
    draftEntriesToDelete.push(entryId);
  }, 30_000);

  // #6 — DEFERRED. See file header.

  it('#7 duplicate posting (posting the same entry twice) is rejected', async () => {
    const entryId = await insertDraftEntry(
      TEST_TENANT_ID,
      accountingBookId,
      new Date().toISOString().slice(0, 10),
      [
        { account_id: roleAccount.default_cash, debit: 25, credit: 0 },
        { account_id: roleAccount.sales_revenue, debit: 0, credit: 25 },
      ],
    );
    const first = await supabase.rpc('fn_post_journal_entry', {
      p_tenant_id: TEST_TENANT_ID,
      p_entry_id: entryId,
      p_posted_by: null,
    });
    expect(first.error).toBeNull();
    postedEntryIds.push(entryId);

    const second = await supabase.rpc('fn_post_journal_entry', {
      p_tenant_id: TEST_TENANT_ID,
      p_entry_id: entryId,
      p_posted_by: null,
    });
    expect(second.error?.message).toMatch(/is not in draft status/);
  }, 30_000);

  it('#8 reversal creates a swapped, re-validated entry and marks the original reversed', async () => {
    const entryId = await insertDraftEntry(
      TEST_TENANT_ID,
      accountingBookId,
      new Date().toISOString().slice(0, 10),
      [
        { account_id: roleAccount.default_cash, debit: 30, credit: 0 },
        { account_id: roleAccount.sales_revenue, debit: 0, credit: 30 },
      ],
    );
    await supabase.rpc('fn_post_journal_entry', {
      p_tenant_id: TEST_TENANT_ID,
      p_entry_id: entryId,
      p_posted_by: null,
    });
    postedEntryIds.push(entryId);

    const { data: reversalId, error } = await supabase.rpc(
      'fn_reverse_journal_entry',
      {
        p_tenant_id: TEST_TENANT_ID,
        p_entry_id: entryId,
        p_reversed_by: null,
        p_posting_date: new Date().toISOString().slice(0, 10),
        p_reason: 'H02 regression',
      },
    );
    expect(error).toBeNull();
    postedEntryIds.push(reversalId as string);

    const original = await getEntry(entryId);
    expect(original.status).toBe('reversed');

    const reversal = await getEntry(reversalId as string);
    expect(reversal.status).toBe('posted');
    expect(reversal.reversal_of_id).toBe(entryId);

    const originalLines = await getLines(entryId);
    const reversalLines = await getLines(reversalId as string);
    expect(reversalLines.length).toBe(originalLines.length);
    for (const rl of reversalLines) {
      const matching = originalLines.find(
        (ol) => ol.account_id === rl.account_id,
      );
      expect(Number(rl.debit_amount)).toBeCloseTo(
        Number(matching.credit_amount),
      );
      expect(Number(rl.credit_amount)).toBeCloseTo(
        Number(matching.debit_amount),
      );
    }
  }, 30_000);

  it("#9 reversing an already-reversed entry is rejected (via the status check — the function's own \"already been reversed\" EXISTS check is unreachable through this normal call sequence, since status flips to 'reversed' in the same call that creates the reversal, confirmed empirically here)", async () => {
    const entryId = await insertDraftEntry(
      TEST_TENANT_ID,
      accountingBookId,
      new Date().toISOString().slice(0, 10),
      [
        { account_id: roleAccount.default_cash, debit: 15, credit: 0 },
        { account_id: roleAccount.sales_revenue, debit: 0, credit: 15 },
      ],
    );
    await supabase.rpc('fn_post_journal_entry', {
      p_tenant_id: TEST_TENANT_ID,
      p_entry_id: entryId,
      p_posted_by: null,
    });
    postedEntryIds.push(entryId);

    const first = await supabase.rpc('fn_reverse_journal_entry', {
      p_tenant_id: TEST_TENANT_ID,
      p_entry_id: entryId,
      p_reversed_by: null,
      p_posting_date: new Date().toISOString().slice(0, 10),
      p_reason: 'H02 regression',
    });
    expect(first.error).toBeNull();
    postedEntryIds.push(first.data as string);

    const second = await supabase.rpc('fn_reverse_journal_entry', {
      p_tenant_id: TEST_TENANT_ID,
      p_entry_id: entryId,
      p_reversed_by: null,
      p_posting_date: new Date().toISOString().slice(0, 10),
      p_reason: 'H02 regression duplicate attempt',
    });
    // Verified live: the original entry's status is already 'reversed' by
    // this point, so fn_reverse_journal_entry's OWN `status <> 'posted'`
    // guard fires first — the function's separate "already been reversed"
    // EXISTS check (migration 182) is real code but effectively dead for
    // this exact call sequence. Asserting the message actually produced,
    // not the one originally assumed in the design.
    expect(second.error?.message).toMatch(
      /Only posted journal entries can be reversed/,
    );
  }, 30_000);

  it('#10 reversing a draft (never posted) entry is rejected', async () => {
    const entryId = await insertDraftEntry(
      TEST_TENANT_ID,
      accountingBookId,
      new Date().toISOString().slice(0, 10),
      [
        { account_id: roleAccount.default_cash, debit: 10, credit: 0 },
        { account_id: roleAccount.sales_revenue, debit: 0, credit: 10 },
      ],
    );
    const { error } = await supabase.rpc('fn_reverse_journal_entry', {
      p_tenant_id: TEST_TENANT_ID,
      p_entry_id: entryId,
      p_reversed_by: null,
      p_posting_date: new Date().toISOString().slice(0, 10),
      p_reason: 'H02 regression',
    });
    expect(error?.message).toMatch(
      /Only posted journal entries can be reversed/,
    );
    draftEntriesToDelete.push(entryId);
  }, 30_000);

  // ======================================================================
  // Group B — fn_post_sales_order core behavior
  // ======================================================================

  it('#11 sales-posting idempotency (sequential): second post is rejected', async () => {
    const orderId = await createOrder({
      payment_method: 'cash',
      subtotal: 20,
      discount: 0,
      tax: 0,
      total: 20,
    });
    await addOrderItem(orderId, serviceItemId, 1, 20);

    const first = await supabase.rpc('fn_post_sales_order', {
      p_tenant_id: TEST_TENANT_ID,
      p_order_id: orderId,
      p_posted_by: null,
    });
    expect(first.error).toBeNull();
    postedEntryIds.push(first.data as string);

    const second = await supabase.rpc('fn_post_sales_order', {
      p_tenant_id: TEST_TENANT_ID,
      p_order_id: orderId,
      p_posted_by: null,
    });
    expect(second.error?.message).toMatch(/already been posted to Accounting/);
  }, 30_000);

  it('#12 sales-posting idempotency (concurrent): exactly one of two simultaneous posts succeeds', async () => {
    const orderId = await createOrder({
      payment_method: 'cash',
      subtotal: 15,
      discount: 0,
      tax: 0,
      total: 15,
    });
    await addOrderItem(orderId, serviceItemId, 1, 15);

    const [r1, r2] = await Promise.all([
      supabase.rpc('fn_post_sales_order', {
        p_tenant_id: TEST_TENANT_ID,
        p_order_id: orderId,
        p_posted_by: null,
      }),
      supabase.rpc('fn_post_sales_order', {
        p_tenant_id: TEST_TENANT_ID,
        p_order_id: orderId,
        p_posted_by: null,
      }),
    ]);
    const results = [r1, r2];
    const successes = results.filter((r) => r.error === null);
    const failures = results.filter((r) => r.error !== null);
    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);
    postedEntryIds.push(successes[0].data as string);
  }, 30_000);

  it('#20 tracked item with real inventory cost posts COGS + Inventory Asset, flag=false', async () => {
    const orderId = await createOrder({
      payment_method: 'cash',
      subtotal: 25,
      discount: 0,
      tax: 0,
      total: 25,
    });
    await addOrderItem(orderId, trackedItemId, 1, 25);
    await recordSaleStockMovement(orderId, trackedItemId, 1, 8);

    const { data: entryId, error } = await supabase.rpc('fn_post_sales_order', {
      p_tenant_id: TEST_TENANT_ID,
      p_order_id: orderId,
      p_posted_by: null,
    });
    expect(error).toBeNull();
    postedEntryIds.push(entryId as string);

    const entry = await getEntry(entryId as string);
    expect(entry.requires_cogs_reconciliation).toBe(false);

    const lines = await getLines(entryId as string);
    const cogsLine = lines.find((l) => l.account_id === roleAccount.cogs);
    const invLine = lines.find(
      (l) => l.account_id === roleAccount.inventory_asset,
    );
    expect(cogsLine).toBeTruthy();
    expect(invLine).toBeTruthy();
    expect(Number(cogsLine.debit_amount)).toBeCloseTo(8);
    expect(Number(invLine.credit_amount)).toBeCloseTo(8);
  }, 30_000);

  it('#22 service-only (non-tracked) sale posts with flag=false and zero COGS lines', async () => {
    const orderId = await createOrder({
      payment_method: 'cash',
      subtotal: 40,
      discount: 0,
      tax: 0,
      total: 40,
    });
    await addOrderItem(orderId, serviceItemId, 1, 40);

    const { data: entryId, error } = await supabase.rpc('fn_post_sales_order', {
      p_tenant_id: TEST_TENANT_ID,
      p_order_id: orderId,
      p_posted_by: null,
    });
    expect(error).toBeNull();
    postedEntryIds.push(entryId as string);

    const entry = await getEntry(entryId as string);
    expect(entry.requires_cogs_reconciliation).toBe(false);

    const lines = await getLines(entryId as string);
    expect(lines.some((l) => l.account_id === roleAccount.cogs)).toBe(false);
  }, 30_000);

  it('#25 order totals that do not reconcile are rejected', async () => {
    const orderId = await createOrder({
      payment_method: 'cash',
      subtotal: 100,
      discount: 0,
      tax: 15,
      total: 999, // deliberately wrong: should be 115
    });
    await addOrderItem(orderId, serviceItemId, 1, 100);

    const { error } = await supabase.rpc('fn_post_sales_order', {
      p_tenant_id: TEST_TENANT_ID,
      p_order_id: orderId,
      p_posted_by: null,
    });
    expect(error?.message).toMatch(/totals do not reconcile/);
  }, 30_000);

  it('#26 tenant isolation: posting an order under the wrong tenant_id finds nothing', async () => {
    const orderId = await createOrder({
      payment_method: 'cash',
      subtotal: 10,
      discount: 0,
      tax: 0,
      total: 10,
    });
    await addOrderItem(orderId, serviceItemId, 1, 10);

    const OTHER_TENANT_ID = '00000000-0000-4000-8000-000000000001'; // does not exist — proves isolation without needing a second real tenant
    const { error } = await supabase.rpc('fn_post_sales_order', {
      p_tenant_id: OTHER_TENANT_ID,
      p_order_id: orderId,
      p_posted_by: null,
    });
    expect(error?.message).toMatch(/not found for tenant/);
  }, 30_000);

  // ======================================================================
  // Group C — payment mapping (13-19)
  // ======================================================================

  it('#13 cash payment settles to default_cash', async () => {
    const orderId = await createOrder({
      payment_method: 'cash',
      subtotal: 12,
      discount: 0,
      tax: 0,
      total: 12,
    });
    await addOrderItem(orderId, serviceItemId, 1, 12);
    const { data: entryId, error } = await supabase.rpc('fn_post_sales_order', {
      p_tenant_id: TEST_TENANT_ID,
      p_order_id: orderId,
      p_posted_by: null,
    });
    expect(error).toBeNull();
    postedEntryIds.push(entryId as string);
    const lines = await getLines(entryId as string);
    expect(
      lines.some(
        (l) =>
          l.account_id === roleAccount.default_cash &&
          Number(l.debit_amount) === 12,
      ),
    ).toBe(true);
  }, 30_000);

  it('#14 card-family payment methods settle to default_bank', async () => {
    for (const method of ['card', 'mada', 'apple_pay']) {
      const orderId = await createOrder({
        payment_method: method,
        subtotal: 9,
        discount: 0,
        tax: 0,
        total: 9,
      });
      await addOrderItem(orderId, serviceItemId, 1, 9);
      const { data: entryId, error } = await supabase.rpc(
        'fn_post_sales_order',
        {
          p_tenant_id: TEST_TENANT_ID,
          p_order_id: orderId,
          p_posted_by: null,
        },
      );
      expect(error).toBeNull();
      postedEntryIds.push(entryId as string);
      const lines = await getLines(entryId as string);
      expect(
        lines.some(
          (l) =>
            l.account_id === roleAccount.default_bank &&
            Number(l.debit_amount) === 9,
        ),
      ).toBe(true);
    }
  }, 30_000);

  it('#15 tab payment (with customer) settles to accounts_receivable', async () => {
    const { data: customer } = await supabase
      .from('customers')
      .select('id')
      .eq('tenant_id', TEST_TENANT_ID)
      .limit(1)
      .maybeSingle();
    if (!customer) return; // no customer fixture available on this tenant — do not fabricate one
    const orderId = await createOrder({
      payment_method: 'tab',
      customer_id: customer.id,
      subtotal: 30,
      discount: 0,
      tax: 0,
      total: 30,
    });
    await addOrderItem(orderId, serviceItemId, 1, 30);
    const { data: entryId, error } = await supabase.rpc('fn_post_sales_order', {
      p_tenant_id: TEST_TENANT_ID,
      p_order_id: orderId,
      p_posted_by: null,
    });
    expect(error).toBeNull();
    postedEntryIds.push(entryId as string);
    const lines = await getLines(entryId as string);
    expect(
      lines.some(
        (l) =>
          l.account_id === roleAccount.accounts_receivable &&
          Number(l.debit_amount) === 30,
      ),
    ).toBe(true);
  }, 30_000);

  it('#16 tab payment without a customer is rejected', async () => {
    const orderId = await createOrder({
      payment_method: 'tab',
      customer_id: null,
      subtotal: 30,
      discount: 0,
      tax: 0,
      total: 30,
    });
    await addOrderItem(orderId, serviceItemId, 1, 30);
    const { error } = await supabase.rpc('fn_post_sales_order', {
      p_tenant_id: TEST_TENANT_ID,
      p_order_id: orderId,
      p_posted_by: null,
    });
    expect(error?.message).toMatch(
      /cannot post to Accounts Receivable without a customer/,
    );
  }, 30_000);

  it('#17 split payment posts two settlement lines summing to the total', async () => {
    const orderId = await createOrder({
      payment_method: 'split',
      cash_amount: 8,
      card_amount: 12,
      subtotal: 20,
      discount: 0,
      tax: 0,
      total: 20,
    });
    await addOrderItem(orderId, serviceItemId, 1, 20);
    const { data: entryId, error } = await supabase.rpc('fn_post_sales_order', {
      p_tenant_id: TEST_TENANT_ID,
      p_order_id: orderId,
      p_posted_by: null,
    });
    expect(error).toBeNull();
    postedEntryIds.push(entryId as string);
    const lines = await getLines(entryId as string);
    const cashLine = lines.find(
      (l) => l.account_id === roleAccount.default_cash,
    );
    const bankLine = lines.find(
      (l) => l.account_id === roleAccount.default_bank,
    );
    expect(Number(cashLine.debit_amount)).toBeCloseTo(8);
    expect(Number(bankLine.debit_amount)).toBeCloseTo(12);
  }, 30_000);

  it('#18 split payment missing cash/card breakdown is rejected', async () => {
    const orderId = await createOrder({
      payment_method: 'split',
      cash_amount: null,
      card_amount: null,
      subtotal: 20,
      discount: 0,
      tax: 0,
      total: 20,
    });
    await addOrderItem(orderId, serviceItemId, 1, 20);
    const { error } = await supabase.rpc('fn_post_sales_order', {
      p_tenant_id: TEST_TENANT_ID,
      p_order_id: orderId,
      p_posted_by: null,
    });
    expect(error?.message).toMatch(
      /no cash_amount\/card_amount breakdown persisted/,
    );
  }, 30_000);

  it('#19 an unrecognized payment_method cannot even reach fn_post_sales_order — orders_payment_method_check rejects it at INSERT time', async () => {
    // Originally designed to post an order with an invalid payment_method
    // and assert fn_post_sales_order's own `ELSE RAISE EXCEPTION
    // 'unrecognized payment_method'` branch (migration 194). Running that
    // scenario surfaced a real finding instead: orders_payment_method_check
    // only permits {cash, card, split, wallet, mada, visa, mastercard,
    // stc_pay, apple_pay, tab} — the exact same set the function already
    // names explicitly — so no row with an "unrecognized" payment_method
    // can ever exist to post in the first place. That branch is real code
    // but provably unreachable through any INSERT-then-post path today.
    // Rewritten, per explicit decision, to test the guard that actually
    // fires: the table-level CHECK constraint itself.
    const { error } = await supabase.from('orders').insert({
      tenant_id: TEST_TENANT_ID,
      branch_id: branchId,
      status: 'completed',
      subtotal: 5,
      discount: 0,
      tax: 0,
      total: 5,
      payment_method: 'bitcoin',
      held: false,
      sale_attempt_id: randomUUID(),
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/orders_payment_method_check/);
  }, 30_000);

  // ======================================================================
  // Group D — COGS reconciliation flag
  // ======================================================================

  it('#21 tracked item with NO recognized inventory cost sets requires_cogs_reconciliation=true', async () => {
    const orderId = await createOrder({
      payment_method: 'cash',
      subtotal: 18,
      discount: 0,
      tax: 0,
      total: 18,
    });
    await addOrderItem(orderId, trackedItemId, 1, 18);
    // Deliberately no stock_movements row — simulates a best-effort stock
    // deduction that never recorded a cost, per M184's own documented
    // Option B design (see migration 194 comment block).

    const { data: entryId, error } = await supabase.rpc('fn_post_sales_order', {
      p_tenant_id: TEST_TENANT_ID,
      p_order_id: orderId,
      p_posted_by: null,
    });
    expect(error).toBeNull();
    postedEntryIds.push(entryId as string);

    const entry = await getEntry(entryId as string);
    expect(entry.requires_cogs_reconciliation).toBe(true);

    const lines = await getLines(entryId as string);
    expect(lines.some((l) => l.account_id === roleAccount.cogs)).toBe(false);
  }, 30_000);

  // ======================================================================
  // Group E — missing branch assignment / missing account role
  // ======================================================================

  it('#23 order on a branch with no Accounting Owner assignment is rejected (fail-closed)', async () => {
    const { data: newBranch, error: branchErr } = await supabase
      .from('branches')
      .insert({
        tenant_id: TEST_TENANT_ID,
        name: uniqueRef('unassigned-branch'),
        is_active: true,
      })
      .select('id')
      .single();
    expect(branchErr).toBeNull();
    branchesToSoftDelete.push(newBranch.id);
    // Deliberately: no branch_accounting_assignments row is ever created
    // for this branch.

    const orderId = await createOrder({
      branch_id: newBranch.id,
      payment_method: 'cash',
      subtotal: 5,
      discount: 0,
      tax: 0,
      total: 5,
    });
    await addOrderItem(orderId, serviceItemId, 1, 5);

    const { error } = await supabase.rpc('fn_post_sales_order', {
      p_tenant_id: TEST_TENANT_ID,
      p_order_id: orderId,
      p_posted_by: null,
    });
    expect(error?.message).toMatch(/No Accounting Owner is assigned to branch/);
  }, 30_000);

  it('#24 tenant missing a required account role is rejected', async () => {
    // Fully self-contained throwaway tenant — see file header for why the
    // demo tenant's real role configuration is never touched for this.
    const { data: tenant, error: tenantErr } = await supabase
      .from('tenants')
      .insert({ name: uniqueRef('h02-missing-role-tenant') })
      .select('id')
      .single();
    expect(tenantErr).toBeNull();
    throwawayTenantId = tenant.id;

    const { data: newOwner } = await supabase
      .from('accounting_owners')
      .insert({
        tenant_id: tenant.id,
        owner_type_code: 'branch',
        name: 'H02 owner',
        status: 'active',
      })
      .select('id')
      .single();
    const { data: newBook } = await supabase
      .from('accounting_books')
      .insert({
        tenant_id: tenant.id,
        accounting_owner_id: newOwner.id,
        book_type: 'primary',
        name: 'H02 book',
        is_default: true,
        status: 'active',
      })
      .select('id')
      .single();
    const { data: newBranch } = await supabase
      .from('branches')
      .insert({ tenant_id: tenant.id, name: 'H02 branch', is_active: true })
      .select('id')
      .single();
    await supabase.from('branch_accounting_assignments').insert({
      tenant_id: tenant.id,
      branch_id: newBranch.id,
      accounting_owner_id: newOwner.id,
      effective_from: '2020-01-01',
    });

    // Reuse the same chart of accounts / role wiring EXCEPT tax_payable —
    // deliberately omitted so an order with nonzero tax triggers the
    // "no account assigned to the tax_payable role" path.
    for (const role of ['sales_revenue', 'default_cash']) {
      const { data: acct } = await supabase
        .from('accounts')
        .insert({
          tenant_id: tenant.id,
          code: role,
          name: role,
          account_type: role === 'sales_revenue' ? 'revenue' : 'asset',
          normal_balance: role === 'sales_revenue' ? 'credit' : 'debit',
          is_posting_account: true,
          is_active: true,
        })
        .select('id')
        .single();
      await supabase
        .from('account_role_assignments')
        .insert({ tenant_id: tenant.id, role_code: role, account_id: acct.id });
    }

    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .insert({
        tenant_id: tenant.id,
        branch_id: newBranch.id,
        status: 'completed',
        subtotal: 100,
        discount: 0,
        tax: 15,
        total: 115,
        payment_method: 'cash',
        held: false,
        sale_attempt_id: randomUUID(),
      })
      .select('id')
      .single();
    if (orderErr) throw orderErr;
    ordersToDelete.push(order.id);
    const { error: itemErr } = await supabase.from('order_items').insert({
      order_id: order.id,
      item_name: 'H02 item',
      qty: 1,
      price: 100,
      total_price: 100,
    });
    if (itemErr) throw itemErr;

    const { error } = await supabase.rpc('fn_post_sales_order', {
      p_tenant_id: tenant.id,
      p_order_id: order.id,
      p_posted_by: null,
    });
    expect(error?.message).toMatch(
      /no account assigned to the tax_payable role/,
    );
  }, 30_000);

  // ======================================================================
  // Group F — fn_reverse_sales_order
  // ======================================================================

  it('#27 reversing a posted sales order creates a correct, auditable reversal', async () => {
    const orderId = await createOrder({
      payment_method: 'cash',
      subtotal: 22,
      discount: 0,
      tax: 0,
      total: 22,
    });
    await addOrderItem(orderId, serviceItemId, 1, 22);

    const { data: entryId } = await supabase.rpc('fn_post_sales_order', {
      p_tenant_id: TEST_TENANT_ID,
      p_order_id: orderId,
      p_posted_by: null,
    });
    postedEntryIds.push(entryId as string);

    const { data: reversalId, error } = await supabase.rpc(
      'fn_reverse_sales_order',
      {
        p_tenant_id: TEST_TENANT_ID,
        p_order_id: orderId,
        p_reversed_by: null,
        p_posting_date: new Date().toISOString().slice(0, 10),
        p_reason: 'H02 regression',
      },
    );
    expect(error).toBeNull();
    postedEntryIds.push(reversalId as string);

    const reversal = await getEntry(reversalId as string);
    expect(reversal.reversal_of_id).toBe(entryId);
    // fn_reverse_journal_entry copies source_module/source_entity_type/
    // source_entity_id from the original onto the reversal (migration 182,
    // the INSERT's SELECT list) — confirmed by reading the function before
    // writing this assertion, not guessed.
    const original = await getEntry(entryId as string);
    expect(reversal.source_module).toBe(original.source_module);
    expect(reversal.source_entity_id).toBe(original.source_entity_id);
  }, 30_000);

  it('#28 reversing an order with no live posting is rejected ("nothing to reverse")', async () => {
    const orderId = await createOrder({
      payment_method: 'cash',
      subtotal: 7,
      discount: 0,
      tax: 0,
      total: 7,
    });
    await addOrderItem(orderId, serviceItemId, 1, 7);
    // Deliberately never posted.

    const { error } = await supabase.rpc('fn_reverse_sales_order', {
      p_tenant_id: TEST_TENANT_ID,
      p_order_id: orderId,
      p_reversed_by: null,
      p_posting_date: new Date().toISOString().slice(0, 10),
      p_reason: 'H02 regression',
    });
    expect(error?.message).toMatch(/nothing to reverse/);
  }, 30_000);

  // ======================================================================
  // Group G — rollback / atomicity
  // ======================================================================

  it('#29 a rejected post leaves no partial state (status/posted_at/posted_by untouched)', async () => {
    const entryId = await insertDraftEntry(
      TEST_TENANT_ID,
      accountingBookId,
      new Date().toISOString().slice(0, 10),
      [
        { account_id: roleAccount.default_cash, debit: 50, credit: 0 },
        { account_id: roleAccount.sales_revenue, debit: 0, credit: 999 }, // deliberately unbalanced
      ],
    );
    const before = await getEntry(entryId);
    const { error } = await supabase.rpc('fn_post_journal_entry', {
      p_tenant_id: TEST_TENANT_ID,
      p_entry_id: entryId,
      p_posted_by: null,
    });
    expect(error).not.toBeNull();
    const after = await getEntry(entryId);
    expect(after.status).toBe('draft');
    expect(after.posted_at).toBeNull();
    expect(after.posted_by).toBeNull();
    expect(after.updated_at).toBe(before.updated_at);
    draftEntriesToDelete.push(entryId);
  }, 30_000);
});
