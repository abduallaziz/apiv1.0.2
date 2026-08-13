-- Sefay Global Financial Platform — Migration M184
-- Sales Posting Integration — per the Accounting Integration Audit §2
-- (Sales → Accounting) and this migration's own explicit approval.
-- Connects existing Sales (`orders`, `order_items`, `stock_movements`)
-- to the M182 Posting Engine. No new Sales Invoice, no new Accounting
-- Customer, no new Payment/AR/Tax table — `orders` remains the sole
-- source of truth, and this migration adds ONLY the functions (and one
-- narrow, additive safety index on the existing `journal_entries`
-- table) needed to turn a completed Order into a Journal Entry through
-- the SAME `fn_post_journal_entry`/`fn_reverse_journal_entry` engine
-- already built and validated in M182 — no posting logic is duplicated
-- or reinvented.
--
-- ============================================================
-- HONEST ARCHITECTURAL BOUNDARIES FOUND DURING THIS MIGRATION'S OWN
-- PRE-IMPLEMENTATION INSPECTION (not invented around, surfaced):
-- ============================================================
--
-- 1. SPLIT PAYMENTS: `orders.payment_method` supports 'split' but the
--    `orders` table carries no cash/card/wallet breakdown of the total
--    — there is no column anywhere recording how much of a split
--    payment was cash vs. card vs. wallet. `fn_post_sales_order` below
--    explicitly REJECTS posting a 'split' order with a clear exception
--    naming this exact gap, rather than guessing a 50/50 split or
--    routing the whole amount to one account. This is a genuine Sales
--    data-model gap, not something this migration is scoped to invent
--    a fix for.
--
-- 2. ACCOUNTS RECEIVABLE: `orders.payment_method` is a NOT-NULL-in-
--    practice CHECK of ('cash','card','split','wallet') — every one of
--    these implies the sale was settled at the point of sale. There is
--    no payment_method value, or any other column, representing "sold
--    on account / unpaid, to be collected later." Therefore **no
--    Sales order in the current schema can ever represent a genuine
--    Accounts Receivable event** — the `accounts_receivable` Account
--    Role (already seeded in M183) is simply never used by this
--    integration, because Sales' own data never asks for it. This is
--    reported as a finding, not silently assumed.
--
-- 3. CUSTOMER PAYMENTS: confirmed again here — no customer-payment
--    ledger exists in Sefay (the `payments` table is Sefay's own SaaS
--    billing mechanism, unrelated). `payment_method` is used only to
--    select which settlement Account Role (`default_cash` for 'cash',
--    `default_bank` for 'card'/'wallet') receives the full order total
--    — no new Payment record is created or invented.
--
-- Scope, exactly as approved:
--   - fn_post_sales_order(): the sole sales-specific posting function,
--     which builds the Journal Entry/Lines and then posts them through
--     M182's unchanged fn_post_journal_entry(). No new posting rules,
--     no new immutability mechanism — 100% reuse of M182.
--   - fn_reverse_sales_order(): looks up the order's original posting
--     and reverses it through M182's unchanged fn_reverse_journal_
--     entry(). Covers both post-posting cancellation and refund —
--     mechanically identical from the ledger's point of view.
--   - One additive, partial unique index on the EXISTING journal_
--     entries table (source-of-record idempotency guarantee — see
--     below). No column, trigger, or function in M182 is modified.
--
-- NOT in scope here: no Payment/AR/AP/Tax/Inventory/Ledger/COA table,
-- no Dimensions, no M185 object. M176–M183 are not modified (only this
-- one additive index touches a table from M182 — its columns, triggers,
-- and functions are untouched). Inventory/WMS is completely untouched —
-- stock_movements is only ever READ here, never written or recomputed.

-- ============================================================
-- Idempotency/concurrency guarantee at the database level: at most one
-- NON-REVERSAL Journal Entry may exist per (tenant, source_module,
-- source_entity_type, source_entity_id). Reversal entries are
-- deliberately excluded (WHERE reversal_of_id IS NULL) because M182's
-- own fn_reverse_journal_entry copies the original's source fields onto
-- the reversal entry by design — a reversal legitimately shares its
-- source with its original, and must not be blocked by this index.
-- ============================================================
CREATE UNIQUE INDEX uq_journal_entries_source_original
  ON journal_entries (tenant_id, source_module, source_entity_type, source_entity_id)
  WHERE reversal_of_id IS NULL AND source_entity_id IS NOT NULL;

-- ============================================================
-- fn_post_sales_order — builds and posts the Journal Entry for one
-- completed Order. SECURITY DEFINER, locks the order row first (the
-- same concurrency pattern as M182's fn_post_journal_entry), performs
-- its own idempotency check under that lock, then delegates the actual
-- posting to M182's unchanged fn_post_journal_entry.
-- ============================================================
CREATE OR REPLACE FUNCTION fn_post_sales_order(
  p_tenant_id UUID,
  p_order_id UUID,
  p_posted_by UUID,
  p_posting_date DATE DEFAULT NULL
) RETURNS UUID
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order            RECORD;
  v_posting_date     DATE;
  v_already_posted   BOOLEAN;
  v_book_id          UUID;
  v_owner_id         UUID;
  v_revenue_acct     UUID;
  v_tax_acct         UUID;
  v_settlement_acct  UUID;
  v_cogs_acct        UUID;
  v_inventory_acct   UUID;
  v_inventory_cost   NUMERIC(14,2);
  v_revenue_amount   NUMERIC(14,2);
  v_entry_id         UUID;
  v_line_no          INTEGER := 1;
  v_expected_total   NUMERIC(14,2);
BEGIN
  SELECT * INTO v_order
  FROM orders
  WHERE id = p_order_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % not found for tenant %', p_order_id, p_tenant_id;
  END IF;

  IF v_order.status <> 'completed' THEN
    RAISE EXCEPTION 'Order % is not completed (status=%) — only completed orders are posted to Accounting', p_order_id, v_order.status;
  END IF;

  IF v_order.branch_id IS NULL THEN
    RAISE EXCEPTION 'Order % has no branch_id — cannot resolve an Accounting Owner without a branch', p_order_id;
  END IF;

  -- Idempotency, under the order-row lock: a concurrent second call for
  -- the same order blocks on the FOR UPDATE above until the first
  -- commits, then observes the posting that already exists here.
  SELECT EXISTS(
    SELECT 1 FROM journal_entries
    WHERE tenant_id = p_tenant_id AND source_module = 'sales' AND source_entity_type = 'order'
      AND source_entity_id = p_order_id AND reversal_of_id IS NULL
  ) INTO v_already_posted;

  IF v_already_posted THEN
    RAISE EXCEPTION 'Order % has already been posted to Accounting', p_order_id;
  END IF;

  -- Honest architectural boundary: split payments carry no cash/card
  -- breakdown anywhere in the schema. Reject explicitly rather than
  -- guess.
  IF v_order.payment_method = 'split' THEN
    RAISE EXCEPTION 'Order % uses payment_method=split, which has no cash/card/wallet breakdown in the orders schema — cannot determine the correct settlement account. This order cannot be posted until Sales records a split breakdown.', p_order_id;
  END IF;

  v_posting_date := coalesce(p_posting_date, v_order.created_at::date);

  -- Sanity: the order's own totals must actually balance before we
  -- build a double-entry Journal Entry out of them.
  v_expected_total := v_order.subtotal - v_order.discount + v_order.tax;
  IF abs(v_order.total - v_expected_total) >= 0.01 THEN
    RAISE EXCEPTION 'Order % totals do not reconcile: total=% but subtotal(%) - discount(%) + tax(%) = %',
      p_order_id, v_order.total, v_order.subtotal, v_order.discount, v_order.tax, v_expected_total;
  END IF;

  -- Resolve Accounting Owner from the Branch, at the order's own
  -- posting date — M178's effective-dated routing, unchanged.
  SELECT accounting_owner_id INTO v_owner_id
  FROM branch_accounting_assignments
  WHERE tenant_id = p_tenant_id AND branch_id = v_order.branch_id
    AND daterange(effective_from, effective_to, '[)') @> v_posting_date;

  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'No Accounting Owner is assigned to branch % on date % (order %)', v_order.branch_id, v_posting_date, p_order_id;
  END IF;

  -- Resolve the Owner's default (Primary) Accounting Book — M180,
  -- unchanged.
  SELECT id INTO v_book_id
  FROM accounting_books
  WHERE tenant_id = p_tenant_id AND accounting_owner_id = v_owner_id AND is_default = true;

  IF v_book_id IS NULL THEN
    RAISE EXCEPTION 'Accounting Owner % has no default Accounting Book (order %)', v_owner_id, p_order_id;
  END IF;

  -- Resolve Account Roles — M183, unchanged. Missing role assignment
  -- is a clear, named exception, never a silent fallback.
  SELECT account_id INTO v_revenue_acct FROM account_role_assignments WHERE tenant_id = p_tenant_id AND role_code = 'sales_revenue';
  IF v_revenue_acct IS NULL THEN
    RAISE EXCEPTION 'Tenant % has no account assigned to the sales_revenue role (order %)', p_tenant_id, p_order_id;
  END IF;

  IF v_order.payment_method = 'cash' THEN
    SELECT account_id INTO v_settlement_acct FROM account_role_assignments WHERE tenant_id = p_tenant_id AND role_code = 'default_cash';
    IF v_settlement_acct IS NULL THEN
      RAISE EXCEPTION 'Tenant % has no account assigned to the default_cash role (order %)', p_tenant_id, p_order_id;
    END IF;
  ELSIF v_order.payment_method IN ('card', 'wallet') THEN
    SELECT account_id INTO v_settlement_acct FROM account_role_assignments WHERE tenant_id = p_tenant_id AND role_code = 'default_bank';
    IF v_settlement_acct IS NULL THEN
      RAISE EXCEPTION 'Tenant % has no account assigned to the default_bank role (order %)', p_tenant_id, p_order_id;
    END IF;
  ELSE
    RAISE EXCEPTION 'Order % has an unrecognized payment_method %', p_order_id, v_order.payment_method;
  END IF;

  IF v_order.tax > 0 THEN
    SELECT account_id INTO v_tax_acct FROM account_role_assignments WHERE tenant_id = p_tenant_id AND role_code = 'tax_payable';
    IF v_tax_acct IS NULL THEN
      RAISE EXCEPTION 'Tenant % has no account assigned to the tax_payable role, but order % has nonzero tax', p_tenant_id, p_order_id;
    END IF;
  END IF;

  -- Inventory cost: READ ONLY from the existing, already-computed
  -- stock_movements.total_cost — never recomputed here. `reference_type
  -- = 'order'` / `reference_id = order.id` is the existing convention
  -- already used by POS inventory deduction (migration 043) and every
  -- module that reads sale movements back (migrations 105, 113, 142,
  -- 143, 158, 159, 164).
  SELECT coalesce(sum(total_cost), 0) INTO v_inventory_cost
  FROM stock_movements
  WHERE tenant_id = p_tenant_id AND reference_type = 'order' AND reference_id = p_order_id AND movement_type = 'sale';

  IF v_inventory_cost > 0 THEN
    SELECT account_id INTO v_cogs_acct FROM account_role_assignments WHERE tenant_id = p_tenant_id AND role_code = 'cogs';
    IF v_cogs_acct IS NULL THEN
      RAISE EXCEPTION 'Tenant % has no account assigned to the cogs role, but order % has inventory cost to recognize', p_tenant_id, p_order_id;
    END IF;
    SELECT account_id INTO v_inventory_acct FROM account_role_assignments WHERE tenant_id = p_tenant_id AND role_code = 'inventory_asset';
    IF v_inventory_acct IS NULL THEN
      RAISE EXCEPTION 'Tenant % has no account assigned to the inventory_asset role, but order % has inventory cost to recognize', p_tenant_id, p_order_id;
    END IF;
  END IF;

  v_revenue_amount := v_order.subtotal - v_order.discount;

  -- Build the draft Journal Entry — inserted as draft, then posted
  -- through M182's own, unmodified posting engine below.
  INSERT INTO journal_entries (
    tenant_id, accounting_book_id, posting_date, document_date, reference,
    description, source_module, source_entity_type, source_entity_id, created_by
  ) VALUES (
    p_tenant_id, v_book_id, v_posting_date, v_posting_date,
    'POS Order ' || p_order_id::text,
    'Sales posting for order ' || p_order_id::text,
    'sales', 'order', p_order_id, p_posted_by
  ) RETURNING id INTO v_entry_id;

  -- Dr Cash/Bank — full order total.
  INSERT INTO journal_lines (tenant_id, journal_entry_id, line_number, account_id, debit_amount, credit_amount)
  VALUES (p_tenant_id, v_entry_id, v_line_no, v_settlement_acct, v_order.total, 0);
  v_line_no := v_line_no + 1;

  -- Cr Revenue — net of discount.
  IF v_revenue_amount > 0 THEN
    INSERT INTO journal_lines (tenant_id, journal_entry_id, line_number, account_id, debit_amount, credit_amount)
    VALUES (p_tenant_id, v_entry_id, v_line_no, v_revenue_acct, 0, v_revenue_amount);
    v_line_no := v_line_no + 1;
  END IF;

  -- Cr Tax Payable — only if the order actually carries tax.
  IF v_order.tax > 0 THEN
    INSERT INTO journal_lines (tenant_id, journal_entry_id, line_number, account_id, debit_amount, credit_amount)
    VALUES (p_tenant_id, v_entry_id, v_line_no, v_tax_acct, 0, v_order.tax);
    v_line_no := v_line_no + 1;
  END IF;

  -- Dr COGS / Cr Inventory Asset — only if this order actually moved
  -- tracked inventory (determined by the existence of matching
  -- stock_movements rows, never assumed from an item-type flag that
  -- does not exist in the schema).
  IF v_inventory_cost > 0 THEN
    INSERT INTO journal_lines (tenant_id, journal_entry_id, line_number, account_id, debit_amount, credit_amount)
    VALUES (p_tenant_id, v_entry_id, v_line_no, v_cogs_acct, v_inventory_cost, 0);
    v_line_no := v_line_no + 1;
    INSERT INTO journal_lines (tenant_id, journal_entry_id, line_number, account_id, debit_amount, credit_amount)
    VALUES (p_tenant_id, v_entry_id, v_line_no, v_inventory_acct, 0, v_inventory_cost);
    v_line_no := v_line_no + 1;
  END IF;

  -- Post through M182's unmodified, already-validated posting engine —
  -- every invariant it enforces (balance, account validity, period
  -- status, book status) applies identically here.
  PERFORM fn_post_journal_entry(p_tenant_id, v_entry_id, p_posted_by);

  RETURN v_entry_id;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION fn_post_sales_order(UUID, UUID, UUID, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_post_sales_order(UUID, UUID, UUID, DATE) TO service_role;

-- ============================================================
-- fn_reverse_sales_order — the sole correction path for a posted sales
-- order, covering BOTH post-posting cancellation and refund (mechanic-
-- ally identical from the ledger's perspective: reverse the original).
-- Finds the order's original posting and delegates entirely to M182's
-- unmodified fn_reverse_journal_entry — never mutates the original.
-- ============================================================
CREATE OR REPLACE FUNCTION fn_reverse_sales_order(
  p_tenant_id UUID,
  p_order_id UUID,
  p_reversed_by UUID,
  p_posting_date DATE,
  p_reason TEXT
) RETURNS UUID
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry_id UUID;
BEGIN
  SELECT id INTO v_entry_id
  FROM journal_entries
  WHERE tenant_id = p_tenant_id AND source_module = 'sales' AND source_entity_type = 'order'
    AND source_entity_id = p_order_id AND reversal_of_id IS NULL;

  IF v_entry_id IS NULL THEN
    RAISE EXCEPTION 'No Accounting posting found for order % — nothing to reverse', p_order_id;
  END IF;

  RETURN fn_reverse_journal_entry(p_tenant_id, v_entry_id, p_reversed_by, p_posting_date, coalesce(p_reason, 'Reversal for order ' || p_order_id::text));
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION fn_reverse_sales_order(UUID, UUID, UUID, DATE, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_reverse_sales_order(UUID, UUID, UUID, DATE, TEXT) TO service_role;

-- No seed data, no backfill. No Sales/Inventory/Payment/AR/Tax table
-- created or modified. Inventory/WMS is completely untouched.

-- Rollback (documented, not auto-executed):
-- REVOKE EXECUTE ON FUNCTION fn_reverse_sales_order(UUID, UUID, UUID, DATE, TEXT) FROM service_role;
-- DROP FUNCTION IF EXISTS fn_reverse_sales_order(UUID, UUID, UUID, DATE, TEXT);
-- REVOKE EXECUTE ON FUNCTION fn_post_sales_order(UUID, UUID, UUID, DATE) FROM service_role;
-- DROP FUNCTION IF EXISTS fn_post_sales_order(UUID, UUID, UUID, DATE);
-- DROP INDEX IF EXISTS uq_journal_entries_source_original;
