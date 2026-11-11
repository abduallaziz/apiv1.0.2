-- 253. Sales returns (partial returns) - Phase 3b of
-- DESIGN-REVIEW-REGISTER-CLOSE-2026-11-09, owner approved 2026-11-09:
--   * a return is a document attached to a COMPLETED order, with its own
--     lines (order_item + quantity); one order can have several returns
--     until every quantity is returned;
--   * stock: only the returned quantities go back (sale_return movement at
--     the original sale cost + a cost layer);
--   * accounting: one journal entry per return that reverses revenue and
--     tax in proportion to what was returned (and COGS/inventory when the
--     sale deducted stock) - ONLY when the original order was itself posted
--     to Accounting (same rule as cancel: nothing posted = nothing to
--     reverse);
--   * refund: cash is paid from the CURRENT open register (blocked when no
--     register is open); non-cash goes back to the original method and
--     never touches the drawer; a split order's refund is split in the same
--     proportion as the sale's cash/card parts.
--
-- Everything happens inside ONE function (fn_create_sales_return), so a
-- return is never half recorded: any failure (closed fiscal period, missing
-- account role, quantity > remaining ...) rolls the whole return back.
-- p_dry_run = true computes and returns the amounts without writing
-- anything (used by the UI preview).
--
-- New-table checklist: tenant_id, deleted_at, RLS policy, service_role GRANT.

CREATE TABLE IF NOT EXISTS sales_returns (
  id               UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id        UUID          REFERENCES branches(id),
  order_id         UUID          NOT NULL REFERENCES orders(id),
  shift_id         UUID          REFERENCES shifts(id),
  refund_method    TEXT          NOT NULL,
  net_amount       NUMERIC(12,2) NOT NULL CHECK (net_amount >= 0),
  tax_amount       NUMERIC(12,2) NOT NULL CHECK (tax_amount >= 0),
  refund_total     NUMERIC(12,2) NOT NULL CHECK (refund_total > 0),
  refund_cash      NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (refund_cash >= 0),
  refund_noncash   NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (refund_noncash >= 0),
  reason           TEXT,
  journal_entry_id UUID          REFERENCES journal_entries(id),
  created_by       UUID          REFERENCES users(id),
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMPTZ,
  CONSTRAINT chk_sales_returns_parts CHECK (abs(refund_cash + refund_noncash - refund_total) < 0.01)
);

CREATE TABLE IF NOT EXISTS sales_return_items (
  id             UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  return_id      UUID          NOT NULL REFERENCES sales_returns(id) ON DELETE CASCADE,
  order_item_id  UUID          NOT NULL REFERENCES order_items(id),
  item_id        UUID          REFERENCES items(id),
  item_name      TEXT          NOT NULL,
  variant_id     UUID          REFERENCES item_variants(id),
  quantity       INTEGER       NOT NULL CHECK (quantity > 0),
  unit_value     NUMERIC(12,4) NOT NULL,
  line_value     NUMERIC(12,2) NOT NULL,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sales_returns_order  ON sales_returns (tenant_id, order_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sales_returns_shift  ON sales_returns (tenant_id, shift_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sales_returns_date   ON sales_returns (tenant_id, created_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sales_return_items_return     ON sales_return_items (tenant_id, return_id);
CREATE INDEX IF NOT EXISTS idx_sales_return_items_order_item ON sales_return_items (tenant_id, order_item_id) WHERE deleted_at IS NULL;

ALTER TABLE sales_returns ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON sales_returns
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE sales_return_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON sales_return_items
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT ALL PRIVILEGES ON public.sales_returns      TO service_role;
GRANT ALL PRIVILEGES ON public.sales_return_items TO service_role;

-- The journal engine only accepts entries whose (source_module,
-- source_entity_type) is registered in the global catalog (FK
-- fk_journal_entries_source, migration 176/182). Register the return type.
INSERT INTO financial_event_source_types (source_module, source_entity_type, label)
VALUES ('sales', 'sales_return', 'Sales Return')
ON CONFLICT (source_module, source_entity_type) DO NOTHING;

-- p_items: [{ "order_item_id": uuid, "quantity": integer }, ...]
CREATE OR REPLACE FUNCTION fn_create_sales_return(
  p_tenant_id uuid,
  p_order_id  uuid,
  p_actor_id  uuid,
  p_shift_id  uuid,
  p_reason    text,
  p_items     jsonb,
  p_dry_run   boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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
  v_tz               TEXT;
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
    SELECT COALESCE(timezone, 'UTC') INTO v_tz FROM tenants WHERE id = p_tenant_id;
    v_posting_date := (now() AT TIME ZONE COALESCE(v_tz, 'UTC'))::date;

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

GRANT EXECUTE ON FUNCTION fn_create_sales_return(uuid, uuid, uuid, uuid, text, jsonb, boolean) TO service_role;

-- ROLLBACK (manual, if ever needed):
-- DROP FUNCTION IF EXISTS fn_create_sales_return(uuid, uuid, uuid, uuid, text, jsonb, boolean);
-- DROP TABLE IF EXISTS sales_return_items; DROP TABLE IF EXISTS sales_returns;
