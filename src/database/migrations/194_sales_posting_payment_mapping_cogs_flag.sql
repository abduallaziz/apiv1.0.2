-- 194 — Sales Posting: full payment-method mapping + COGS reconciliation flag
-- (M184 Integration, approved 2026-08-13). "APPROVED — PROCEED WITH M184
-- IMPLEMENTATION." Scope, exactly as approved across the M184 design
-- review series:
--   1. journal_entries.requires_cogs_reconciliation — set once, at the
--      same INSERT fn_post_sales_order() already performs, never mutated
--      afterward (fully compatible with the existing posted-entry
--      immutability guard, which is untouched by this migration).
--   2. fn_post_sales_order() updated to recognize every real
--      CreateInvoiceDto.payment_method value (previously only
--      cash/card/wallet were handled; mada/visa/mastercard/stc_pay/
--      apple_pay all raised "unrecognized payment_method", and split was
--      unconditionally rejected despite migration 188 already persisting
--      the exact cash_amount/card_amount breakdown this needed).
--
-- Does NOT touch: fn_post_journal_entry, fn_reverse_journal_entry,
-- fn_reverse_sales_order, any guard trigger, price_override_policies/
-- price_override_audit, EffectiveRoleResolver, PermissionsService,
-- role hierarchy, or any D01 table. No AR sub-ledger/collection system
-- added for `tab` — recorded as a Known Product Gap in this comment only,
-- per the approved decision, not built.

ALTER TABLE journal_entries
  ADD COLUMN requires_cogs_reconciliation BOOLEAN NOT NULL DEFAULT false;

-- Partial index for a future "entries needing attention" query — no UI
-- consumes this yet; the column+index exist so that UI can be built
-- later without another schema change.
CREATE INDEX idx_journal_entries_needs_reconciliation
  ON journal_entries (tenant_id, created_at)
  WHERE requires_cogs_reconciliation = true;

CREATE OR REPLACE FUNCTION fn_post_sales_order(
  p_tenant_id uuid,
  p_order_id uuid,
  p_posted_by uuid,
  p_posting_date date DEFAULT NULL::date
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order                  RECORD;
  v_posting_date           DATE;
  v_already_posted         BOOLEAN;
  v_book_id                UUID;
  v_owner_id                UUID;
  v_revenue_acct           UUID;
  v_tax_acct               UUID;
  v_settlement_acct         UUID;
  v_cash_settlement_acct    UUID;
  v_bank_settlement_acct    UUID;
  v_cogs_acct              UUID;
  v_inventory_acct         UUID;
  v_inventory_cost         NUMERIC(14,2);
  v_revenue_amount         NUMERIC(14,2);
  v_entry_id               UUID;
  v_line_no                INTEGER := 1;
  v_expected_total         NUMERIC(14,2);
  v_has_tracked_items      BOOLEAN;
  v_requires_reconciliation BOOLEAN;
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
  -- the same order blocks here until this transaction commits or rolls
  -- back, then observes the posting that already exists here. The
  -- uq_journal_entries_source partial unique index (migration 195) is a
  -- separate, DB-level defense-in-depth layer for any path that might
  -- bypass this function entirely — this check remains the primary,
  -- always-exercised guard.
  SELECT EXISTS(
    SELECT 1 FROM journal_entries
    WHERE tenant_id = p_tenant_id AND source_module = 'sales' AND source_entity_type = 'order'
      AND source_entity_id = p_order_id AND reversal_of_id IS NULL
  ) INTO v_already_posted;

  IF v_already_posted THEN
    RAISE EXCEPTION 'Order % has already been posted to Accounting', p_order_id;
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
  -- posting date — M178's effective-dated routing, unchanged. Fail-
  -- closed: no fallback to any tenant-default account exists, per the
  -- explicit Owner Decision that unassigned branches must reject, not
  -- silently guess.
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

  -- Settlement account resolution — full payment-method mapping per the
  -- M184 Owner Decision (2026-08-13):
  --   cash                                              -> default_cash
  --   card/wallet/mada/visa/mastercard/stc_pay/apple_pay -> default_bank
  --   tab                                                -> accounts_receivable
  --   split                                              -> default_cash (cash_amount)
  --                                                       + default_bank (card_amount), two lines
  -- No new Account Role introduced — the five card-network/wallet
  -- methods share default_bank because nothing in Sefay's own code or
  -- schema distinguishes them operationally or financially today.
  IF v_order.payment_method = 'cash' THEN
    SELECT account_id INTO v_settlement_acct FROM account_role_assignments WHERE tenant_id = p_tenant_id AND role_code = 'default_cash';
    IF v_settlement_acct IS NULL THEN
      RAISE EXCEPTION 'Tenant % has no account assigned to the default_cash role (order %)', p_tenant_id, p_order_id;
    END IF;

  ELSIF v_order.payment_method IN ('card', 'wallet', 'mada', 'visa', 'mastercard', 'stc_pay', 'apple_pay') THEN
    SELECT account_id INTO v_settlement_acct FROM account_role_assignments WHERE tenant_id = p_tenant_id AND role_code = 'default_bank';
    IF v_settlement_acct IS NULL THEN
      RAISE EXCEPTION 'Tenant % has no account assigned to the default_bank role (order %)', p_tenant_id, p_order_id;
    END IF;

  ELSIF v_order.payment_method = 'tab' THEN
    IF v_order.customer_id IS NULL THEN
      RAISE EXCEPTION 'Order % uses payment_method=tab but has no customer_id — cannot post to Accounts Receivable without a customer', p_order_id;
    END IF;
    SELECT account_id INTO v_settlement_acct FROM account_role_assignments WHERE tenant_id = p_tenant_id AND role_code = 'accounts_receivable';
    IF v_settlement_acct IS NULL THEN
      RAISE EXCEPTION 'Tenant % has no account assigned to the accounts_receivable role (order %)', p_tenant_id, p_order_id;
    END IF;

  ELSIF v_order.payment_method = 'split' THEN
    IF v_order.cash_amount IS NULL OR v_order.card_amount IS NULL THEN
      RAISE EXCEPTION 'Order % uses payment_method=split but has no cash_amount/card_amount breakdown persisted', p_order_id;
    END IF;
    SELECT account_id INTO v_cash_settlement_acct FROM account_role_assignments WHERE tenant_id = p_tenant_id AND role_code = 'default_cash';
    IF v_cash_settlement_acct IS NULL THEN
      RAISE EXCEPTION 'Tenant % has no account assigned to the default_cash role (order %, split payment)', p_tenant_id, p_order_id;
    END IF;
    SELECT account_id INTO v_bank_settlement_acct FROM account_role_assignments WHERE tenant_id = p_tenant_id AND role_code = 'default_bank';
    IF v_bank_settlement_acct IS NULL THEN
      RAISE EXCEPTION 'Tenant % has no account assigned to the default_bank role (order %, split payment)', p_tenant_id, p_order_id;
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
  -- module that reads sale movements back.
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

  -- COGS Reconciliation flag — M184 Owner Decision (Option B, 2026-08-13).
  -- Stock deduction is deliberately best-effort (STATUS.md §64: "a stock
  -- problem never blocks a completed sale") — this flag makes a resulting
  -- COGS gap VISIBLE in the ledger instead of silently invisible, without
  -- fabricating a cost or blocking the sale/posting. Never recomputes
  -- inventory cost; only compares "did this order sell any tracked-
  -- inventory item" against "did any inventory cost actually get
  -- recognized." A pure-service/non-tracked-item sale correctly resolves
  -- to false — zero COGS is the RIGHT answer there, not a gap.
  SELECT EXISTS(
    SELECT 1 FROM order_items oi
    JOIN items i ON i.id = oi.item_id AND i.tenant_id = p_tenant_id
    WHERE oi.order_id = p_order_id AND i.has_inventory = true
  ) INTO v_has_tracked_items;

  v_requires_reconciliation := v_has_tracked_items AND v_inventory_cost = 0;

  v_revenue_amount := v_order.subtotal - v_order.discount;

  -- Build the draft Journal Entry — inserted as draft, then posted
  -- through M182's own, unmodified posting engine below. The
  -- reconciliation flag is set ONCE, here, at creation — never mutated
  -- afterward, so it never touches the posted-entry immutability guard.
  INSERT INTO journal_entries (
    tenant_id, accounting_book_id, posting_date, document_date, reference,
    description, source_module, source_entity_type, source_entity_id, created_by,
    requires_cogs_reconciliation
  ) VALUES (
    p_tenant_id, v_book_id, v_posting_date, v_posting_date,
    'POS Order ' || p_order_id::text,
    'Sales posting for order ' || p_order_id::text,
    'sales', 'order', p_order_id, p_posted_by,
    v_requires_reconciliation
  ) RETURNING id INTO v_entry_id;

  -- Dr Settlement — cash/bank/AR by payment method, or two lines for split.
  IF v_order.payment_method = 'split' THEN
    IF v_order.cash_amount > 0 THEN
      INSERT INTO journal_lines (tenant_id, journal_entry_id, line_number, account_id, debit_amount, credit_amount)
      VALUES (p_tenant_id, v_entry_id, v_line_no, v_cash_settlement_acct, v_order.cash_amount, 0);
      v_line_no := v_line_no + 1;
    END IF;
    IF v_order.card_amount > 0 THEN
      INSERT INTO journal_lines (tenant_id, journal_entry_id, line_number, account_id, debit_amount, credit_amount)
      VALUES (p_tenant_id, v_entry_id, v_line_no, v_bank_settlement_acct, v_order.card_amount, 0);
      v_line_no := v_line_no + 1;
    END IF;
  ELSE
    INSERT INTO journal_lines (tenant_id, journal_entry_id, line_number, account_id, debit_amount, credit_amount)
    VALUES (p_tenant_id, v_entry_id, v_line_no, v_settlement_acct, v_order.total, 0);
    v_line_no := v_line_no + 1;
  END IF;

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
  -- stock_movements rows, never assumed).
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
  -- status, book status) applies identically here. A closed fiscal
  -- period causes this call to raise, which — because this entire
  -- function runs inside the caller's transaction — rolls back this
  -- draft entry and its lines along with it.
  PERFORM fn_post_journal_entry(p_tenant_id, v_entry_id, p_posted_by);

  RETURN v_entry_id;
END;
$function$;

-- Rollback (documented, not auto-executed):
-- CREATE OR REPLACE FUNCTION fn_post_sales_order(...) -- restore prior version (see migration 184)
-- DROP INDEX IF EXISTS idx_journal_entries_needs_reconciliation;
-- ALTER TABLE journal_entries DROP COLUMN IF EXISTS requires_cogs_reconciliation;
