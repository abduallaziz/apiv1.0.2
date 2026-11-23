-- CANDIDATE (NOT APPLIED ANYWHERE, NOT SCANNED by migrate.ts): wires the posting-date policy (327) into the
-- three posting functions. Requires 325 + 326 + 327. Needs separate owner approval (P1-D6) and the gates in
-- POSTING_DATE_DECISION_REPORT.md. Generated from the live local definitions of 266/253/278 with minimal edits:
--   fn_post_sales_order      : default date = policy('sale', orders.created_at)           (was created_at::date in the DB session zone)
--   fn_reverse_sales_order   : NULL date => policy('cancel', now(), original entry date); an explicit date is still honoured
--   fn_create_sales_return   : policy('return', now(), original sale entry date)           (was COALESCE(tz,'UTC') now())
-- Rollback: migrations_pending/rollback/328_posting_date_policy_wiring_ROLLBACK.sql (verbatim previous definitions).
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

  v_posting_date := coalesce(p_posting_date, fn_posting_date_for_event(p_tenant_id, 'sale', v_order.created_at));

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
$function$;

CREATE OR REPLACE FUNCTION public.fn_reverse_sales_order(p_tenant_id uuid, p_order_id uuid, p_reversed_by uuid, p_posting_date date, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_entry_id UUID;
  v_order    RECORD;
  v_orig     DATE;
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

  -- explicit date from the caller is honoured (backward compatible); NULL => policy (tenant-local date of now, floored at the original entry)
  SELECT posting_date INTO v_orig FROM journal_entries WHERE id = v_entry_id;
  RETURN fn_reverse_journal_entry(p_tenant_id, v_entry_id, p_reversed_by,
    coalesce(p_posting_date, fn_posting_date_for_event(p_tenant_id, 'cancel', now(), v_orig)),
    coalesce(p_reason, 'Reversal for order ' || p_order_id::text));
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_create_sales_return(p_tenant_id uuid, p_order_id uuid, p_actor_id uuid, p_shift_id uuid, p_reason text, p_items jsonb, p_dry_run boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_catalog'
AS $function$
DECLARE
  v_order            RECORD;
  v_line             RECORD;
  v_oi               RECORD;
  v_mv               RECORD;
  v_return_id        UUID := uuid_generate_v4();
  v_returned_value   NUMERIC := 0;
  v_share            NUMERIC;
  v_net              NUMERIC;
  v_tax              NUMERIC;
  v_total            NUMERIC;
  v_prev_net         NUMERIC;
  v_prev_tax         NUMERIC;
  v_prev_total       NUMERIC;
  v_prev_qty_item    NUMERIC;
  v_prev_qty_all     NUMERIC;
  v_this_qty_all     NUMERIC := 0;
  v_order_qty_all    NUMERIC;
  v_cash             NUMERIC := 0;
  v_noncash          NUMERIC := 0;
  v_shift_status     TEXT;
  v_lines            JSONB := '[]'::jsonb;
  v_has_inventory    BOOLEAN;
  v_unit_cost        NUMERIC;
  v_inventory_cost   NUMERIC := 0;
  v_tracked_returned BOOLEAN := false;
  v_posted           BOOLEAN;
  v_orig_posting     DATE;
  v_posting_date     DATE;
  v_owner_id         UUID;
  v_book_id          UUID;
  v_revenue_acct     UUID;
  v_tax_acct         UUID;
  v_cash_acct        UUID;
  v_bank_acct        UUID;
  v_ar_acct          UUID;
  v_cogs_acct        UUID;
  v_inventory_acct   UUID;
  v_entry_id         UUID;
  v_line_no          INTEGER := 1;
BEGIN
  SELECT * INTO v_order
  FROM orders
  WHERE id = p_order_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % not found for tenant %', p_order_id, p_tenant_id;
  END IF;
  IF v_order.status <> 'completed' THEN
    RAISE EXCEPTION 'Order % is not completed (status=%) - only completed orders can be returned', p_order_id, v_order.status;
  END IF;
  IF v_order.subtotal IS NULL OR v_order.subtotal <= 0 THEN
    RAISE EXCEPTION 'Order % has no value to return', p_order_id;
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'No items to return';
  END IF;

  -- Validate each requested line against what is still returnable.
  FOR v_line IN
    SELECT x.order_item_id, SUM(x.quantity) AS qty
    FROM jsonb_to_recordset(p_items) AS x(order_item_id uuid, quantity numeric)
    GROUP BY x.order_item_id
  LOOP
    IF v_line.qty IS NULL OR v_line.qty <= 0 OR v_line.qty <> floor(v_line.qty) THEN
      RAISE EXCEPTION 'Return quantity must be a positive whole number (order item %)', v_line.order_item_id;
    END IF;

    SELECT * INTO v_oi
    FROM order_items
    WHERE id = v_line.order_item_id AND order_id = p_order_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Order item % does not belong to order %', v_line.order_item_id, p_order_id;
    END IF;

    SELECT COALESCE(SUM(ri.quantity), 0) INTO v_prev_qty_item
    FROM sales_return_items ri
    JOIN sales_returns r ON r.id = ri.return_id AND r.deleted_at IS NULL
    WHERE ri.tenant_id = p_tenant_id AND ri.order_item_id = v_oi.id AND ri.deleted_at IS NULL;

    IF v_line.qty > v_oi.qty - v_prev_qty_item THEN
      RAISE EXCEPTION 'Cannot return % of "%" - only % remaining', v_line.qty, v_oi.item_name, v_oi.qty - v_prev_qty_item;
    END IF;

    v_returned_value := v_returned_value + v_line.qty * (v_oi.total_price / v_oi.qty);
    v_this_qty_all   := v_this_qty_all + v_line.qty;
    v_lines := v_lines || jsonb_build_object(
      'order_item_id', v_oi.id,
      'item_name', v_oi.item_name,
      'quantity', v_line.qty,
      'unit_value', round(v_oi.total_price / v_oi.qty, 4),
      'line_value', round(v_line.qty * (v_oi.total_price / v_oi.qty), 2)
    );
  END LOOP;

  -- Previous returns of this order.
  SELECT COALESCE(SUM(net_amount), 0), COALESCE(SUM(tax_amount), 0), COALESCE(SUM(refund_total), 0)
    INTO v_prev_net, v_prev_tax, v_prev_total
  FROM sales_returns
  WHERE tenant_id = p_tenant_id AND order_id = p_order_id AND deleted_at IS NULL;

  SELECT COALESCE(SUM(ri.quantity), 0) INTO v_prev_qty_all
  FROM sales_return_items ri
  JOIN sales_returns r ON r.id = ri.return_id AND r.deleted_at IS NULL
  WHERE ri.tenant_id = p_tenant_id AND r.order_id = p_order_id AND ri.deleted_at IS NULL;

  SELECT COALESCE(SUM(qty), 0) INTO v_order_qty_all
  FROM order_items WHERE order_id = p_order_id AND deleted_at IS NULL;

  -- Refund = the returned share of the order's net (after order discount)
  -- and of its tax. The return that completes the order takes the exact
  -- remainder, so rounding can never make refunds exceed the order total.
  v_share := v_returned_value / v_order.subtotal;
  IF v_prev_qty_all + v_this_qty_all = v_order_qty_all THEN
    v_net := (v_order.subtotal - v_order.discount) - v_prev_net;
    v_tax := v_order.tax - v_prev_tax;
  ELSE
    v_net := round(v_share * (v_order.subtotal - v_order.discount), 2);
    v_tax := round(v_share * v_order.tax, 2);
  END IF;
  v_total := v_net + v_tax;

  IF v_total <= 0 THEN
    RAISE EXCEPTION 'Nothing to refund for this return';
  END IF;
  IF v_prev_total + v_total > v_order.total + 0.01 THEN
    RAISE EXCEPTION 'Refund (% already + %) would exceed the order total %', v_prev_total, v_total, v_order.total;
  END IF;

  -- How the refund is paid out.
  IF v_order.payment_method = 'cash' THEN
    v_cash := v_total;
  ELSIF v_order.payment_method = 'split' THEN
    v_cash := LEAST(round(v_total * COALESCE(v_order.cash_amount, 0) / NULLIF(v_order.total, 0), 2), v_total);
    v_noncash := v_total - v_cash;
  ELSE
    v_noncash := v_total;
  END IF;

  IF v_cash > 0 THEN
    IF p_shift_id IS NULL THEN
      RAISE EXCEPTION 'No open register: a cash refund is paid from the open register';
    END IF;
    SELECT status INTO v_shift_status FROM shifts WHERE id = p_shift_id AND tenant_id = p_tenant_id AND deleted_at IS NULL;
    IF v_shift_status IS DISTINCT FROM 'open' THEN
      RAISE EXCEPTION 'No open register: a cash refund is paid from the open register';
    END IF;
  END IF;

  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'dry_run', true,
      'net_amount', v_net, 'tax_amount', v_tax, 'refund_total', v_total,
      'refund_cash', v_cash, 'refund_noncash', v_noncash,
      'refund_method', v_order.payment_method,
      'lines', v_lines
    );
  END IF;

  -- ---- writes -------------------------------------------------------
  INSERT INTO sales_returns (
    id, tenant_id, branch_id, order_id, shift_id, refund_method,
    net_amount, tax_amount, refund_total, refund_cash, refund_noncash,
    reason, created_by
  ) VALUES (
    v_return_id, p_tenant_id, v_order.branch_id, p_order_id, p_shift_id, v_order.payment_method,
    v_net, v_tax, v_total, v_cash, v_noncash,
    NULLIF(btrim(COALESCE(p_reason, '')), ''), p_actor_id
  );

  FOR v_line IN
    SELECT x.order_item_id, SUM(x.quantity) AS qty
    FROM jsonb_to_recordset(p_items) AS x(order_item_id uuid, quantity numeric)
    GROUP BY x.order_item_id
  LOOP
    SELECT * INTO v_oi FROM order_items WHERE id = v_line.order_item_id;

    INSERT INTO sales_return_items (
      tenant_id, return_id, order_item_id, item_id, item_name, variant_id,
      quantity, unit_value, line_value
    ) VALUES (
      p_tenant_id, v_return_id, v_oi.id, v_oi.item_id, v_oi.item_name, v_oi.variant_id,
      v_line.qty::integer, round(v_oi.total_price / v_oi.qty, 4),
      round(v_line.qty * (v_oi.total_price / v_oi.qty), 2)
    );

    -- Restock ONLY the returned quantity, at the cost the sale deducted
    -- (no-op for non-tracked items / sales that deducted no stock).
    IF v_oi.item_id IS NOT NULL THEN
      SELECT has_inventory INTO v_has_inventory FROM items WHERE id = v_oi.item_id AND tenant_id = p_tenant_id;
      IF COALESCE(v_has_inventory, false) THEN
        v_tracked_returned := true;
        SELECT m.warehouse_id, m.location_id, m.batch_id,
               SUM(m.quantity) AS qty, SUM(m.total_cost) AS cost
          INTO v_mv
        FROM stock_movements m
        WHERE m.tenant_id = p_tenant_id AND m.reference_type = 'order' AND m.reference_id = p_order_id
          AND m.movement_type = 'sale' AND m.item_id = v_oi.item_id
          AND m.variant_id IS NOT DISTINCT FROM v_oi.variant_id
        GROUP BY m.warehouse_id, m.location_id, m.batch_id
        ORDER BY SUM(m.quantity) DESC
        LIMIT 1;

        IF FOUND AND v_mv.qty > 0 THEN
          v_unit_cost := v_mv.cost / v_mv.qty;
          PERFORM fn_apply_stock_movement(
            p_tenant_id, v_mv.warehouse_id, v_mv.location_id,
            v_oi.item_id, v_oi.variant_id, v_mv.batch_id,
            'sale_return', 'in', v_line.qty, v_unit_cost,
            'sales_return', v_return_id, p_actor_id
          );
          PERFORM fn_add_cost_layer(
            p_tenant_id, v_mv.warehouse_id, v_oi.item_id, v_oi.variant_id,
            v_mv.batch_id, v_line.qty, v_unit_cost, NULL
          );
          v_inventory_cost := v_inventory_cost + round(v_line.qty * v_unit_cost, 2);
        END IF;
      END IF;
    END IF;
  END LOOP;

  -- ---- accounting: only when the original order was itself posted ----
  SELECT EXISTS (
    SELECT 1 FROM journal_entries
    WHERE tenant_id = p_tenant_id AND source_module = 'sales' AND source_entity_type = 'order'
      AND source_entity_id = p_order_id AND reversal_of_id IS NULL
  ) INTO v_posted;

  IF v_posted THEN
    SELECT posting_date INTO v_orig_posting FROM journal_entries
    WHERE tenant_id = p_tenant_id AND source_module = 'sales' AND source_entity_type = 'order'
      AND source_entity_id = p_order_id AND reversal_of_id IS NULL;
    v_posting_date := fn_posting_date_for_event(p_tenant_id, 'return', now(), v_orig_posting);

    SELECT accounting_owner_id INTO v_owner_id
    FROM branch_accounting_assignments
    WHERE tenant_id = p_tenant_id AND branch_id = v_order.branch_id
      AND daterange(effective_from, effective_to, '[)') @> v_posting_date;
    IF v_owner_id IS NULL THEN
      RAISE EXCEPTION 'No Accounting Owner is assigned to branch % on date % (return of order %)', v_order.branch_id, v_posting_date, p_order_id;
    END IF;

    SELECT id INTO v_book_id
    FROM accounting_books
    WHERE tenant_id = p_tenant_id AND accounting_owner_id = v_owner_id AND is_default = true;
    IF v_book_id IS NULL THEN
      RAISE EXCEPTION 'Accounting Owner % has no default Accounting Book (return of order %)', v_owner_id, p_order_id;
    END IF;

    SELECT account_id INTO v_revenue_acct FROM account_role_assignments WHERE tenant_id = p_tenant_id AND role_code = 'sales_revenue';
    IF v_revenue_acct IS NULL AND v_net > 0 THEN
      RAISE EXCEPTION 'Tenant % has no account assigned to the sales_revenue role', p_tenant_id;
    END IF;
    IF v_tax > 0 THEN
      SELECT account_id INTO v_tax_acct FROM account_role_assignments WHERE tenant_id = p_tenant_id AND role_code = 'tax_payable';
      IF v_tax_acct IS NULL THEN
        RAISE EXCEPTION 'Tenant % has no account assigned to the tax_payable role', p_tenant_id;
      END IF;
    END IF;
    IF v_cash > 0 THEN
      SELECT account_id INTO v_cash_acct FROM account_role_assignments WHERE tenant_id = p_tenant_id AND role_code = 'default_cash';
      IF v_cash_acct IS NULL THEN
        RAISE EXCEPTION 'Tenant % has no account assigned to the default_cash role', p_tenant_id;
      END IF;
    END IF;
    IF v_noncash > 0 THEN
      IF v_order.payment_method = 'tab' THEN
        SELECT account_id INTO v_ar_acct FROM account_role_assignments WHERE tenant_id = p_tenant_id AND role_code = 'accounts_receivable';
        IF v_ar_acct IS NULL THEN
          RAISE EXCEPTION 'Tenant % has no account assigned to the accounts_receivable role', p_tenant_id;
        END IF;
      ELSE
        SELECT account_id INTO v_bank_acct FROM account_role_assignments WHERE tenant_id = p_tenant_id AND role_code = 'default_bank';
        IF v_bank_acct IS NULL THEN
          RAISE EXCEPTION 'Tenant % has no account assigned to the default_bank role', p_tenant_id;
        END IF;
      END IF;
    END IF;
    IF v_inventory_cost > 0 THEN
      SELECT account_id INTO v_cogs_acct FROM account_role_assignments WHERE tenant_id = p_tenant_id AND role_code = 'cogs';
      SELECT account_id INTO v_inventory_acct FROM account_role_assignments WHERE tenant_id = p_tenant_id AND role_code = 'inventory_asset';
      IF v_cogs_acct IS NULL OR v_inventory_acct IS NULL THEN
        RAISE EXCEPTION 'Tenant % has no cogs / inventory_asset account roles, but the return restocks inventory', p_tenant_id;
      END IF;
    END IF;

    INSERT INTO journal_entries (
      tenant_id, accounting_book_id, posting_date, document_date, reference,
      description, source_module, source_entity_type, source_entity_id, created_by,
      requires_cogs_reconciliation
    ) VALUES (
      p_tenant_id, v_book_id, v_posting_date, v_posting_date, v_return_id::text,
      NULL, 'sales', 'sales_return', v_return_id, p_actor_id,
      (v_tracked_returned AND v_inventory_cost = 0)
    ) RETURNING id INTO v_entry_id;

    -- Debit: the revenue and tax that were recognised on the sale.
    IF v_net > 0 THEN
      INSERT INTO journal_lines (tenant_id, journal_entry_id, line_number, account_id, debit_amount, credit_amount)
      VALUES (p_tenant_id, v_entry_id, v_line_no, v_revenue_acct, v_net, 0);
      v_line_no := v_line_no + 1;
    END IF;
    IF v_tax > 0 THEN
      INSERT INTO journal_lines (tenant_id, journal_entry_id, line_number, account_id, debit_amount, credit_amount)
      VALUES (p_tenant_id, v_entry_id, v_line_no, v_tax_acct, v_tax, 0);
      v_line_no := v_line_no + 1;
    END IF;

    -- Credit: where the money goes back out.
    IF v_cash > 0 THEN
      INSERT INTO journal_lines (tenant_id, journal_entry_id, line_number, account_id, debit_amount, credit_amount)
      VALUES (p_tenant_id, v_entry_id, v_line_no, v_cash_acct, 0, v_cash);
      v_line_no := v_line_no + 1;
    END IF;
    IF v_noncash > 0 THEN
      INSERT INTO journal_lines (tenant_id, journal_entry_id, line_number, account_id, debit_amount, credit_amount)
      VALUES (p_tenant_id, v_entry_id, v_line_no,
              CASE WHEN v_order.payment_method = 'tab' THEN v_ar_acct ELSE v_bank_acct END,
              0, v_noncash);
      v_line_no := v_line_no + 1;
    END IF;

    -- Cost of goods: the stock came back, so reverse the COGS charge.
    IF v_inventory_cost > 0 THEN
      INSERT INTO journal_lines (tenant_id, journal_entry_id, line_number, account_id, debit_amount, credit_amount)
      VALUES (p_tenant_id, v_entry_id, v_line_no, v_inventory_acct, v_inventory_cost, 0);
      v_line_no := v_line_no + 1;
      INSERT INTO journal_lines (tenant_id, journal_entry_id, line_number, account_id, debit_amount, credit_amount)
      VALUES (p_tenant_id, v_entry_id, v_line_no, v_cogs_acct, 0, v_inventory_cost);
      v_line_no := v_line_no + 1;
    END IF;

    PERFORM fn_post_journal_entry(p_tenant_id, v_entry_id, p_actor_id);

    UPDATE sales_returns SET journal_entry_id = v_entry_id WHERE id = v_return_id;
  END IF;

  RETURN jsonb_build_object(
    'dry_run', false,
    'id', v_return_id,
    'net_amount', v_net, 'tax_amount', v_tax, 'refund_total', v_total,
    'refund_cash', v_cash, 'refund_noncash', v_noncash,
    'refund_method', v_order.payment_method,
    'journal_entry_id', v_entry_id,
    'lines', v_lines
  );
END;
$function$;
