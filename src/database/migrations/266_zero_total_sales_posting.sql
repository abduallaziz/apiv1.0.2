-- 266_zero_total_sales_posting.sql   (verified on a local Postgres: free/paid/discounted orders post and reverse correctly)
-- A sale whose total is 0 (e.g. a reward/discount covering the whole bill) failed in
-- fn_post_sales_order: the settlement line "Dr cash/bank = order.total" had amount 0 and
-- journal_lines requires debit_amount > 0 OR credit_amount > 0, so the whole sale returned 500.
--  * fn_post_sales_order: skip the settlement line when total = 0; when there is nothing at all
--    to post (no total, revenue, tax or inventory cost) return NULL without creating an entry.
--    The API ignores the return value. Same signature -> plain CREATE OR REPLACE (no overload).
--  * fn_reverse_sales_order: a free order that posted nothing has nothing to reverse (return NULL
--    instead of raising), so cancelling it works.
-- ROLLBACK: re-apply the bodies from migrations 196 (post) and 184 (reverse).

CREATE OR REPLACE FUNCTION public.fn_post_sales_order(p_tenant_id uuid, p_order_id uuid, p_posted_by uuid, p_posting_date date DEFAULT NULL::date)
 RETURNS uuid
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

  SELECT EXISTS(
    SELECT 1 FROM journal_entries
    WHERE tenant_id = p_tenant_id AND source_module = 'sales' AND source_entity_type = 'order'
      AND source_entity_id = p_order_id AND reversal_of_id IS NULL
  ) INTO v_already_posted;

  IF v_already_posted THEN
    RAISE EXCEPTION 'Order % has already been posted to Accounting', p_order_id;
  END IF;

  v_posting_date := coalesce(p_posting_date, v_order.created_at::date);

  v_expected_total := v_order.subtotal - v_order.discount + v_order.tax;
  IF abs(v_order.total - v_expected_total) >= 0.01 THEN
    RAISE EXCEPTION 'Order % totals do not reconcile: total=% but subtotal(%) - discount(%) + tax(%) = %',
      p_order_id, v_order.total, v_order.subtotal, v_order.discount, v_order.tax, v_expected_total;
  END IF;

  SELECT accounting_owner_id INTO v_owner_id
  FROM branch_accounting_assignments
  WHERE tenant_id = p_tenant_id AND branch_id = v_order.branch_id
    AND daterange(effective_from, effective_to, '[)') @> v_posting_date;

  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'No Accounting Owner is assigned to branch % on date % (order %)', v_order.branch_id, v_posting_date, p_order_id;
  END IF;

  SELECT id INTO v_book_id
  FROM accounting_books
  WHERE tenant_id = p_tenant_id AND accounting_owner_id = v_owner_id AND is_default = true;

  IF v_book_id IS NULL THEN
    RAISE EXCEPTION 'Accounting Owner % has no default Accounting Book (order %)', v_owner_id, p_order_id;
  END IF;

  SELECT account_id INTO v_revenue_acct FROM account_role_assignments WHERE tenant_id = p_tenant_id AND role_code = 'sales_revenue';
  IF v_revenue_acct IS NULL THEN
    RAISE EXCEPTION 'Tenant % has no account assigned to the sales_revenue role (order %)', p_tenant_id, p_order_id;
  END IF;

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

  SELECT EXISTS(
    SELECT 1 FROM order_items oi
    JOIN items i ON i.id = oi.item_id AND i.tenant_id = p_tenant_id
    WHERE oi.order_id = p_order_id AND i.has_inventory = true
  ) INTO v_has_tracked_items;

  v_requires_reconciliation := v_has_tracked_items AND v_inventory_cost = 0;

  v_revenue_amount := v_order.subtotal - v_order.discount;

  -- Free sale (total 0, no net revenue, no tax, no inventory cost): there is
  -- nothing to post, and a journal entry cannot contain zero-amount lines.
  IF v_order.total <= 0 AND v_revenue_amount <= 0 AND v_order.tax <= 0 AND v_inventory_cost <= 0 THEN
    RETURN NULL;
  END IF;

  -- reference: bare order id, no language, no prefix — the web UI builds
  -- the human label from source_module/source_entity_type via i18n and
  -- shortens the id for display. description: left NULL — same reason.
  INSERT INTO journal_entries (
    tenant_id, accounting_book_id, posting_date, document_date, reference,
    description, source_module, source_entity_type, source_entity_id, created_by,
    requires_cogs_reconciliation
  ) VALUES (
    p_tenant_id, v_book_id, v_posting_date, v_posting_date,
    p_order_id::text,
    NULL,
    'sales', 'order', p_order_id, p_posted_by,
    v_requires_reconciliation
  ) RETURNING id INTO v_entry_id;

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
  ELSIF v_order.total > 0 THEN
    INSERT INTO journal_lines (tenant_id, journal_entry_id, line_number, account_id, debit_amount, credit_amount)
    VALUES (p_tenant_id, v_entry_id, v_line_no, v_settlement_acct, v_order.total, 0);
    v_line_no := v_line_no + 1;
  END IF;

  IF v_revenue_amount > 0 THEN
    INSERT INTO journal_lines (tenant_id, journal_entry_id, line_number, account_id, debit_amount, credit_amount)
    VALUES (p_tenant_id, v_entry_id, v_line_no, v_revenue_acct, 0, v_revenue_amount);
    v_line_no := v_line_no + 1;
  END IF;

  IF v_order.tax > 0 THEN
    INSERT INTO journal_lines (tenant_id, journal_entry_id, line_number, account_id, debit_amount, credit_amount)
    VALUES (p_tenant_id, v_entry_id, v_line_no, v_tax_acct, 0, v_order.tax);
    v_line_no := v_line_no + 1;
  END IF;

  IF v_inventory_cost > 0 THEN
    INSERT INTO journal_lines (tenant_id, journal_entry_id, line_number, account_id, debit_amount, credit_amount)
    VALUES (p_tenant_id, v_entry_id, v_line_no, v_cogs_acct, v_inventory_cost, 0);
    v_line_no := v_line_no + 1;
    INSERT INTO journal_lines (tenant_id, journal_entry_id, line_number, account_id, debit_amount, credit_amount)
    VALUES (p_tenant_id, v_entry_id, v_line_no, v_inventory_acct, 0, v_inventory_cost);
    v_line_no := v_line_no + 1;
  END IF;

  PERFORM fn_post_journal_entry(p_tenant_id, v_entry_id, p_posted_by);

  RETURN v_entry_id;
END;
$function$
;

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
  v_order    RECORD;
BEGIN
  SELECT id INTO v_entry_id
  FROM journal_entries
  WHERE tenant_id = p_tenant_id AND source_module = 'sales' AND source_entity_type = 'order'
    AND source_entity_id = p_order_id AND reversal_of_id IS NULL;

  IF v_entry_id IS NULL THEN
    SELECT total, subtotal, discount, tax INTO v_order
    FROM orders WHERE id = p_order_id AND tenant_id = p_tenant_id;
    -- A free order (nothing to post) legitimately has no journal entry.
    IF FOUND AND v_order.total <= 0 AND (v_order.subtotal - v_order.discount) <= 0 AND v_order.tax <= 0 THEN
      RETURN NULL;
    END IF;
    RAISE EXCEPTION 'No Accounting posting found for order % — nothing to reverse', p_order_id;
  END IF;

  RETURN fn_reverse_journal_entry(p_tenant_id, v_entry_id, p_reversed_by, p_posting_date, coalesce(p_reason, 'Reversal for order ' || p_order_id::text));
END;
$$ LANGUAGE plpgsql;
