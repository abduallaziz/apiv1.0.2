-- 330 — T5: safe, repeatable reconciliation of historical completed sales that have NO sales journal entry.
--
-- STATUS: PENDING — lives in migrations_pending/ (not scanned by migrate.ts). Designed and tested on LOCAL
-- databases only. Adding it to production is a separate, owner-approved step; RUNNING the apply function in
-- production is a further, per-list approval. Applying this file only creates objects: it posts NOTHING.
--
-- Requires: 325 (fn_tenant_posting_date) and 327 (fn_posting_date_for_event). Does NOT require 326/328:
-- the pre-flight below refuses any date outside an existing fiscal period, so the 326 safety net (which would
-- auto-extend a fiscal year) is never reached by this mechanism, and the posting date is always passed
-- explicitly, so 328 (default-date wiring) changes nothing here.
--
-- POSTING-DATE POLICY (the one choice made here):
--   posting_date = the ORIGINAL sale date in the tenant's own time zone  (fn_posting_date_for_event('sale', created_at)).
--   It is used only if (a) a fiscal period for that date EXISTS and is 'open', (b) an Accounting Owner is assigned
--   to the order's branch on that date, (c) the default book is active, (d) the account roles the engine needs exist.
--   Otherwise the order is REFUSED and listed with a reason code. There is no "nearest open date" fallback, no
--   override date, no period reopening, no fiscal-year creation, no assignment back-dating: anything that would
--   require one of those is an owner decision outside this mechanism.
--
-- DOUBLE-POSTING DEFENCE (three independent layers):
--   1. pre-flight: any existing entry for the order (source_module='sales', source_entity_type='order',
--      reversal_of_id IS NULL — including one that was later reversed) => 'skipped_already_posted', never touched;
--   2. fn_post_sales_order (the real engine) itself raises if an entry exists, and locks the order row FOR UPDATE;
--   3. unique index uq_journal_entries_source: a concurrent racer gets unique_violation, recorded as skipped.
--
-- Every apply attempt (posted / skipped / refused / failed) writes one row to an APPEND-ONLY audit table, outside
-- the per-order savepoint, so a failed order is still recorded while its partial work is rolled back.

-- ---------------------------------------------------------------------------
-- 1. Audit table (append-only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS historical_sales_reconciliation_audit (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id           UUID NOT NULL,
  run_label        TEXT NOT NULL,
  tenant_id        UUID NOT NULL REFERENCES tenants(id),
  order_id         UUID NOT NULL,
  action           TEXT NOT NULL CHECK (action IN
                     ('posted','skipped_already_posted','skipped_nothing_to_post','refused','failed')),
  reason_code      TEXT,
  reason_detail    TEXT,
  posting_date     DATE,
  journal_entry_id UUID,
  order_total      NUMERIC(14,2),
  performed_by     UUID NOT NULL REFERENCES users(id),   -- the approving / posting user supplied by the caller
  db_role          TEXT NOT NULL DEFAULT current_user,
  performed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hsra_run   ON historical_sales_reconciliation_audit (run_id);
CREATE INDEX IF NOT EXISTS idx_hsra_order ON historical_sales_reconciliation_audit (tenant_id, order_id);

CREATE OR REPLACE FUNCTION fn_hsra_append_only() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'historical_sales_reconciliation_audit is append-only (% rejected)', TG_OP;
END;
$$;
DROP TRIGGER IF EXISTS trg_hsra_no_update_delete ON historical_sales_reconciliation_audit;
CREATE TRIGGER trg_hsra_no_update_delete BEFORE UPDATE OR DELETE ON historical_sales_reconciliation_audit
  FOR EACH ROW EXECUTE FUNCTION fn_hsra_append_only();
DROP TRIGGER IF EXISTS trg_hsra_no_truncate ON historical_sales_reconciliation_audit;
CREATE TRIGGER trg_hsra_no_truncate BEFORE TRUNCATE ON historical_sales_reconciliation_audit
  FOR EACH STATEMENT EXECUTE FUNCTION fn_hsra_append_only();

ALTER TABLE historical_sales_reconciliation_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_session_isolation ON historical_sales_reconciliation_audit;
CREATE POLICY tenant_session_isolation ON historical_sales_reconciliation_audit
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid)
  WITH CHECK (tenant_id = (current_setting('app.tenant_id', true))::uuid);

-- ---------------------------------------------------------------------------
-- 2. Pre-flight: the decision for ONE order. Read-only. Mirrors, in the engine's own order, every condition
--    under which fn_post_sales_order / fn_post_journal_entry would raise, plus the policy refusals above.
--    decision: 'post' | 'skip' | 'refuse'
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_historical_sales_preflight(p_order_id UUID)
RETURNS TABLE (
  order_id UUID, tenant_id UUID, branch_id UUID, sale_at TIMESTAMPTZ, posting_date DATE,
  total NUMERIC, subtotal NUMERIC, discount NUMERIC, tax NUMERIC,
  expected_revenue NUMERIC, expected_cogs NUMERIC, tracked_without_stock_movement BOOLEAN,
  decision TEXT, reason_code TEXT, reason_detail TEXT
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  o RECORD;
  v_date DATE;
  v_cost NUMERIC := 0;
  v_rev NUMERIC;
  v_tracked BOOLEAN := FALSE;
  v_code TEXT;
  v_detail TEXT;
  v_decision TEXT := 'post';
  v_period_status TEXT;
  v_owner UUID;
  v_book_status TEXT;
  v_role TEXT;
  v_need TEXT[];
BEGIN
  SELECT * INTO o FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT p_order_id, NULL::uuid, NULL::uuid, NULL::timestamptz, NULL::date, NULL::numeric, NULL::numeric,
      NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric, NULL::boolean, 'refuse'::text, 'order_not_found'::text,
      'no such order'::text;
    RETURN;
  END IF;

  v_rev := o.subtotal - o.discount;
  SELECT coalesce(sum(sm.total_cost), 0) INTO v_cost FROM stock_movements sm
   WHERE sm.tenant_id = o.tenant_id AND sm.reference_type = 'order' AND sm.reference_id = o.id AND sm.movement_type = 'sale';
  SELECT EXISTS (SELECT 1 FROM order_items oi JOIN items i ON i.id = oi.item_id AND i.tenant_id = o.tenant_id
                  WHERE oi.order_id = o.id AND i.has_inventory = true) INTO v_tracked;

  IF EXISTS (SELECT 1 FROM journal_entries j WHERE j.tenant_id = o.tenant_id AND j.source_module = 'sales'
              AND j.source_entity_type = 'order' AND j.source_entity_id = o.id AND j.reversal_of_id IS NULL) THEN
    v_decision := 'skip'; v_code := 'already_posted'; v_detail := 'a sales journal entry already exists (possibly reversed); never touched';
  ELSIF o.status <> 'completed' THEN
    v_decision := 'refuse'; v_code := 'not_completed'; v_detail := 'status=' || o.status;
  ELSIF o.deleted_at IS NOT NULL THEN
    v_decision := 'refuse'; v_code := 'order_deleted'; v_detail := 'order is soft-deleted';
  ELSIF o.total <= 0 AND v_rev <= 0 AND o.tax <= 0 AND v_cost <= 0 THEN
    v_decision := 'skip'; v_code := 'nothing_to_post'; v_detail := 'free sale: the engine posts nothing';
  ELSIF EXISTS (SELECT 1 FROM sales_returns r WHERE r.order_id = o.id AND r.deleted_at IS NULL) THEN
    v_decision := 'refuse'; v_code := 'sales_return_exists'; v_detail := 'a return is recorded against this order: needs human review';
  ELSIF o.branch_id IS NULL THEN
    v_decision := 'refuse'; v_code := 'no_branch'; v_detail := 'order has no branch';
  ELSIF abs(o.total - (o.subtotal - o.discount + o.tax)) >= 0.01 THEN
    v_decision := 'refuse'; v_code := 'totals_do_not_reconcile';
    v_detail := format('total=%s subtotal-discount+tax=%s', o.total, o.subtotal - o.discount + o.tax);
  END IF;

  -- posting date (strict tenant zone, no fallback); only needed for the date-dependent checks
  IF v_decision = 'post' THEN
    BEGIN
      v_date := fn_posting_date_for_event(o.tenant_id, 'sale', o.created_at);
    EXCEPTION WHEN OTHERS THEN
      v_decision := 'refuse'; v_code := 'invalid_tenant_timezone'; v_detail := left(SQLERRM, 200);
    END;
  END IF;

  IF v_decision = 'post' THEN
    SELECT fp.status INTO v_period_status FROM fiscal_periods fp
     WHERE fp.tenant_id = o.tenant_id AND daterange(fp.start_date, fp.end_date, '[)') @> v_date;
    IF NOT FOUND THEN
      v_decision := 'refuse'; v_code := 'no_fiscal_period';
      v_detail := 'no fiscal period covers ' || v_date || ' (this mechanism never creates one)';
    ELSIF v_period_status <> 'open' THEN
      v_decision := 'refuse'; v_code := 'period_not_open'; v_detail := 'period status=' || v_period_status || ' (never reopened)';
    END IF;
  END IF;

  IF v_decision = 'post' THEN
    SELECT a.accounting_owner_id INTO v_owner FROM branch_accounting_assignments a
     WHERE a.tenant_id = o.tenant_id AND a.branch_id = o.branch_id
       AND daterange(a.effective_from, a.effective_to, '[)') @> v_date;
    IF v_owner IS NULL THEN
      v_decision := 'refuse'; v_code := 'no_accounting_owner_at_date';
      v_detail := 'no Accounting Owner assigned to the branch on ' || v_date || ' (assignments are never back-dated here)';
    ELSE
      SELECT b.status INTO v_book_status FROM accounting_books b
       WHERE b.tenant_id = o.tenant_id AND b.accounting_owner_id = v_owner AND b.is_default = true;
      IF NOT FOUND THEN
        v_decision := 'refuse'; v_code := 'no_default_book'; v_detail := 'Accounting Owner has no default book';
      ELSIF v_book_status <> 'active' THEN
        v_decision := 'refuse'; v_code := 'book_not_active'; v_detail := 'book status=' || v_book_status;
      END IF;
    END IF;
  END IF;

  IF v_decision = 'post' THEN
    IF o.payment_method = 'cash' THEN v_need := ARRAY['default_cash'];
    ELSIF o.payment_method IN ('card','wallet','mada','visa','mastercard','stc_pay','apple_pay') THEN v_need := ARRAY['default_bank'];
    ELSIF o.payment_method = 'tab' THEN
      v_need := ARRAY['accounts_receivable'];
      IF o.customer_id IS NULL THEN v_decision := 'refuse'; v_code := 'tab_without_customer'; v_detail := 'payment_method=tab but no customer'; END IF;
    ELSIF o.payment_method = 'split' THEN
      v_need := ARRAY['default_cash','default_bank'];
      IF o.cash_amount IS NULL OR o.card_amount IS NULL THEN
        v_decision := 'refuse'; v_code := 'split_breakdown_missing'; v_detail := 'split payment without a cash/card breakdown: needs human review';
      END IF;
    ELSE
      v_decision := 'refuse'; v_code := 'unrecognized_payment_method'; v_detail := coalesce(o.payment_method, '<null>');
    END IF;
  END IF;

  IF v_decision = 'post' THEN
    v_need := array_append(v_need, 'sales_revenue');
    IF o.tax > 0 THEN v_need := array_append(v_need, 'tax_payable'); END IF;
    IF v_cost > 0 THEN v_need := v_need || ARRAY['cogs','inventory_asset']; END IF;
    FOREACH v_role IN ARRAY v_need LOOP
      IF NOT EXISTS (SELECT 1 FROM account_role_assignments r WHERE r.tenant_id = o.tenant_id AND r.role_code = v_role) THEN
        v_decision := 'refuse'; v_code := 'missing_account_role'; v_detail := 'no account assigned to role ' || v_role;
        EXIT;
      END IF;
    END LOOP;
  END IF;

  IF v_decision = 'post' THEN
    v_code := CASE WHEN v_tracked AND v_cost = 0 THEN 'ok_cogs_unknown' ELSE 'ok' END;
    v_detail := CASE WHEN v_tracked AND v_cost = 0
      THEN 'will post revenue/tax/settlement; stock-tracked items without a stock movement: entry is flagged requires_cogs_reconciliation, no COGS posted'
      ELSE 'will post at ' || v_date END;
  END IF;

  RETURN QUERY SELECT o.id, o.tenant_id, o.branch_id, o.created_at, v_date, o.total, o.subtotal, o.discount, o.tax,
    v_rev, v_cost, (v_tracked AND v_cost = 0), v_decision, v_code, v_detail;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. (a) Dry run: what WOULD be posted, and why anything is skipped/refused. Read-only.
--    p_order_ids NULL => discover every completed, non-deleted order with total > 0 that has no sales entry.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_historical_sales_dry_run(
  p_order_ids UUID[] DEFAULT NULL,
  p_tenant_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 5000
) RETURNS TABLE (
  order_id UUID, tenant_id UUID, branch_id UUID, sale_at TIMESTAMPTZ, posting_date DATE,
  total NUMERIC, subtotal NUMERIC, discount NUMERIC, tax NUMERIC,
  expected_revenue NUMERIC, expected_cogs NUMERIC, tracked_without_stock_movement BOOLEAN,
  decision TEXT, reason_code TEXT, reason_detail TEXT
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT pf.*
  FROM (
    SELECT o.id FROM orders o
     WHERE p_order_ids IS NULL
       AND o.status = 'completed' AND o.total > 0 AND o.deleted_at IS NULL
       AND (p_tenant_id IS NULL OR o.tenant_id = p_tenant_id)
       AND NOT EXISTS (SELECT 1 FROM journal_entries j WHERE j.tenant_id = o.tenant_id AND j.source_module = 'sales'
                        AND j.source_entity_type = 'order' AND j.source_entity_id = o.id AND j.reversal_of_id IS NULL)
    UNION
    SELECT x FROM unnest(p_order_ids) AS x WHERE p_order_ids IS NOT NULL
    ORDER BY 1
    LIMIT greatest(p_limit, 1)
  ) c
  CROSS JOIN LATERAL fn_historical_sales_preflight(c.id) pf
$$;

-- ---------------------------------------------------------------------------
-- 4. (b) Apply: post an EXPLICIT approved list through the real engine, one savepoint per order.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_apply_historical_sales_reconciliation(
  p_order_ids      UUID[],
  p_approved_by    UUID,              -- existing users.id: recorded in the audit and used as posted_by of each entry
  p_run_label      TEXT,              -- owner approval reference, e.g. 'owner-approval-2026-12-01'
  p_expected_total NUMERIC DEFAULT NULL  -- optional integrity guard: SUM(orders.total) of the approved list
) RETURNS TABLE (
  run_id UUID, order_id UUID, action TEXT, reason_code TEXT, reason_detail TEXT,
  posting_date DATE, journal_entry_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run UUID := gen_random_uuid();
  v_ids UUID[];
  v_oid UUID;
  o RECORD;
  pf RECORD;
  v_entry UUID;
  v_action TEXT;
  v_code TEXT;
  v_detail TEXT;
  v_sum NUMERIC;
BEGIN
  IF p_order_ids IS NULL OR cardinality(p_order_ids) = 0 THEN
    RAISE EXCEPTION 'historical_reconciliation: an explicit non-empty approved order list is required';
  END IF;
  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_ids FROM unnest(p_order_ids) x WHERE x IS NOT NULL;
  IF v_ids IS NULL OR cardinality(v_ids) > 500 THEN
    RAISE EXCEPTION 'historical_reconciliation: list must contain 1..500 distinct order ids (got %)', coalesce(cardinality(v_ids), 0);
  END IF;
  IF p_run_label IS NULL OR btrim(p_run_label) = '' THEN
    RAISE EXCEPTION 'historical_reconciliation: p_run_label (approval reference) is required';
  END IF;
  IF p_approved_by IS NULL OR NOT EXISTS (SELECT 1 FROM users u WHERE u.id = p_approved_by) THEN
    RAISE EXCEPTION 'historical_reconciliation: p_approved_by must be an existing user id';
  END IF;
  IF p_expected_total IS NOT NULL THEN
    SELECT coalesce(sum(od.total), 0) INTO v_sum FROM orders od WHERE od.id = ANY (v_ids);
    IF v_sum <> p_expected_total THEN
      RAISE EXCEPTION 'historical_reconciliation: approved total % does not match the list total % (nothing was posted)', p_expected_total, v_sum;
    END IF;
  END IF;

  FOREACH v_oid IN ARRAY v_ids LOOP
    v_entry := NULL; v_action := NULL; v_code := NULL; v_detail := NULL;

    -- Lock the order row so a concurrent apply/sale path serialises with us, then decide on fresh data.
    SELECT od.id, od.tenant_id, od.total INTO o FROM orders od WHERE od.id = v_oid FOR UPDATE;
    IF NOT FOUND THEN
      -- unknown id: cannot be audited against a tenant (FK); surfaced in the result only
      run_id := v_run; order_id := v_oid; action := 'refused'; reason_code := 'order_not_found';
      reason_detail := 'no such order'; posting_date := NULL; journal_entry_id := NULL;
      RETURN NEXT;
      CONTINUE;
    END IF;

    SELECT * INTO pf FROM fn_historical_sales_preflight(v_oid);

    IF pf.decision = 'skip' THEN
      v_action := CASE pf.reason_code WHEN 'already_posted' THEN 'skipped_already_posted' ELSE 'skipped_nothing_to_post' END;
      v_code := pf.reason_code; v_detail := pf.reason_detail;
    ELSIF pf.decision = 'refuse' THEN
      v_action := 'refused'; v_code := pf.reason_code; v_detail := pf.reason_detail;
    ELSE
      BEGIN   -- per-order savepoint: any failure undoes ONLY this order's partial work
        v_entry := fn_post_sales_order(o.tenant_id, v_oid, p_approved_by, pf.posting_date);
        IF v_entry IS NULL THEN
          v_action := 'skipped_nothing_to_post'; v_code := 'nothing_to_post'; v_detail := 'engine returned no entry';
        ELSE
          v_action := 'posted'; v_code := pf.reason_code; v_detail := pf.reason_detail;
        END IF;
      EXCEPTION
        WHEN unique_violation THEN
          v_entry := NULL; v_action := 'skipped_already_posted'; v_code := 'already_posted_race';
          v_detail := 'uq_journal_entries_source: another session posted this order first';
        WHEN OTHERS THEN
          v_entry := NULL; v_action := 'failed'; v_code := 'engine_error'; v_detail := left(SQLERRM, 500);
      END;
    END IF;

    INSERT INTO historical_sales_reconciliation_audit
      (run_id, run_label, tenant_id, order_id, action, reason_code, reason_detail, posting_date, journal_entry_id,
       order_total, performed_by)
    VALUES (v_run, p_run_label, o.tenant_id, v_oid, v_action, v_code, v_detail,
            pf.posting_date,
            v_entry, o.total, p_approved_by);

    run_id := v_run; order_id := v_oid; action := v_action; reason_code := v_code; reason_detail := v_detail;
    posting_date := pf.posting_date; journal_entry_id := v_entry;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. (c) Verification views: live before/after totals and per-run effect on the ledger.
-- ---------------------------------------------------------------------------
-- Per tenant and sale month: how much completed revenue is still without an entry, and how much was reconciled
-- by this mechanism (before = still unposted + reconciled).
CREATE OR REPLACE VIEW v_historical_sales_reconciliation AS
WITH base AS (
  SELECT o.tenant_id, to_char(o.created_at, 'YYYY-MM') AS sale_month, o.id, o.total, o.tax, o.discount,
         EXISTS (SELECT 1 FROM journal_entries j WHERE j.tenant_id = o.tenant_id AND j.source_module = 'sales'
                  AND j.source_entity_type = 'order' AND j.source_entity_id = o.id AND j.reversal_of_id IS NULL) AS has_entry,
         EXISTS (SELECT 1 FROM historical_sales_reconciliation_audit a
                  WHERE a.order_id = o.id AND a.action = 'posted') AS reconciled
  FROM orders o
  WHERE o.status = 'completed' AND o.total > 0 AND o.deleted_at IS NULL
)
SELECT tenant_id, sale_month,
       count(*) FILTER (WHERE NOT has_entry)                              AS unposted_orders_now,
       coalesce(sum(total) FILTER (WHERE NOT has_entry), 0)               AS unposted_total_now,
       coalesce(sum(tax)   FILTER (WHERE NOT has_entry), 0)               AS unposted_tax_now,
       count(*) FILTER (WHERE reconciled AND has_entry)                   AS reconciled_orders,
       coalesce(sum(total) FILTER (WHERE reconciled AND has_entry), 0)    AS reconciled_total,
       coalesce(sum(tax)   FILTER (WHERE reconciled AND has_entry), 0)    AS reconciled_tax,
       count(*) FILTER (WHERE NOT has_entry OR reconciled)                AS unposted_orders_before,
       coalesce(sum(total) FILTER (WHERE NOT has_entry OR reconciled), 0) AS unposted_total_before
FROM base GROUP BY tenant_id, sale_month;

-- Per run: what the posted entries put into the ledger by role (settlement = cash+bank+AR).
CREATE OR REPLACE VIEW v_historical_sales_reconciliation_run AS
WITH c AS (   -- counts come from the audit alone (no join => no row multiplication)
  SELECT a.run_id, a.run_label, a.tenant_id,
         count(*) FILTER (WHERE a.action = 'posted')                        AS posted_orders,
         count(*) FILTER (WHERE a.action = 'skipped_already_posted')        AS skipped_already_posted,
         count(*) FILTER (WHERE a.action = 'skipped_nothing_to_post')       AS skipped_nothing_to_post,
         count(*) FILTER (WHERE a.action = 'refused')                       AS refused,
         count(*) FILTER (WHERE a.action = 'failed')                        AS failed,
         coalesce(sum(a.order_total) FILTER (WHERE a.action = 'posted'), 0) AS posted_order_total
  FROM historical_sales_reconciliation_audit a
  GROUP BY a.run_id, a.run_label, a.tenant_id
), s AS (     -- ledger effect of the entries this run posted, by account role
  SELECT a.run_id, a.tenant_id,
         coalesce(sum(l.credit_amount) FILTER (WHERE r.role_code = 'sales_revenue'), 0) AS revenue_credited,
         coalesce(sum(l.credit_amount) FILTER (WHERE r.role_code = 'tax_payable'), 0)   AS vat_credited,
         coalesce(sum(l.debit_amount)  FILTER (WHERE r.role_code IN ('default_cash','default_bank','accounts_receivable')), 0) AS settlement_debited,
         coalesce(sum(l.debit_amount)  FILTER (WHERE r.role_code = 'cogs'), 0)            AS cogs_debited,
         coalesce(sum(l.credit_amount) FILTER (WHERE r.role_code = 'inventory_asset'), 0) AS inventory_credited
  FROM historical_sales_reconciliation_audit a
  JOIN journal_lines l ON l.journal_entry_id = a.journal_entry_id AND l.tenant_id = a.tenant_id
  JOIN account_role_assignments r ON r.tenant_id = l.tenant_id AND r.account_id = l.account_id
  WHERE a.action = 'posted'
  GROUP BY a.run_id, a.tenant_id
)
SELECT c.run_id, c.run_label, c.tenant_id, c.posted_orders, c.skipped_already_posted, c.skipped_nothing_to_post,
       c.refused, c.failed, c.posted_order_total,
       coalesce(s.revenue_credited, 0) AS revenue_credited, coalesce(s.vat_credited, 0) AS vat_credited,
       coalesce(s.settlement_debited, 0) AS settlement_debited, coalesce(s.cogs_debited, 0) AS cogs_debited,
       coalesce(s.inventory_credited, 0) AS inventory_credited
FROM c LEFT JOIN s ON s.run_id = c.run_id AND s.tenant_id = c.tenant_id;

-- ---------------------------------------------------------------------------
-- 6. Grants: service_role only (same stance as 327). The audit table is not exposed to API roles.
-- ---------------------------------------------------------------------------
REVOKE ALL ON historical_sales_reconciliation_audit FROM PUBLIC, anon, authenticated;
REVOKE ALL ON v_historical_sales_reconciliation FROM PUBLIC, anon, authenticated;
REVOKE ALL ON v_historical_sales_reconciliation_run FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fn_hsra_append_only() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fn_historical_sales_preflight(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fn_historical_sales_dry_run(UUID[], UUID, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fn_apply_historical_sales_reconciliation(UUID[], UUID, TEXT, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT SELECT ON historical_sales_reconciliation_audit TO service_role;
GRANT SELECT ON v_historical_sales_reconciliation TO service_role;
GRANT SELECT ON v_historical_sales_reconciliation_run TO service_role;
GRANT EXECUTE ON FUNCTION fn_historical_sales_preflight(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION fn_historical_sales_dry_run(UUID[], UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION fn_apply_historical_sales_reconciliation(UUID[], UUID, TEXT, NUMERIC) TO service_role;

-- ROLLBACK: migrations_pending/rollback/330_historical_sales_reconciliation_ROLLBACK.sql
