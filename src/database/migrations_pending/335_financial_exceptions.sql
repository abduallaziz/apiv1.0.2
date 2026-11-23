-- 335_financial_exceptions.sql — WP-E: durable record + idempotent catch-up for swallowed stock failures in the pooled sale path.
--
-- PROBLEM (T2 / WP-D, VERIFIED locally): in createWithItemsPooled a stock failure is swallowed by a SAVEPOINT; the sale and its
--   revenue entry commit, but (a) nothing durable says which line failed, and (b) the savepoint wraps the WHOLE order, so the
--   healthy lines lose their movements too. The cancel restock is a separate best-effort call after commit.
-- WHAT THIS ADDS (all additive; nothing changes unless the API flag SALE_EXCEPTION_RECORDING_ENABLED=true, default false):
--   1. table financial_exceptions (+ unique dedupe key, indexes, RLS, service_role-only grants)
--   2. fn_process_sale_stock_deduction_line       per-line deduction (idempotent per order+item+variant, same lock as 333)
--   3. fn_record_financial_exception              idempotent insert (the same failure is never recorded twice)
--   4. fn_financial_exception_retry / _retry_batch  retry the line, post the missing COGS ONCE through the real engine
--   5. fn_financial_exception_on_order_cancel     cancel hygiene: close open rows, reverse catch-up COGS entries
--   6. monitor M-10 (open exceptions) and fn_fin_monitor_all extended to include it (fn_fin_monitor_summary unchanged)
-- CATCH-UP ENTRY: journal_entries(source_module='sales', source_entity_type='order_cogs_catchup', source_entity_id = exception id),
--   Dr COGS / Cr Inventory asset, same book and posting date as the sale's own entry. uq_journal_entries_source (195) makes a
--   second entry for the same exception impossible. A closed/locked period is REFUSED (exception stays open, attempts++).
-- DEPENDS ON: 328 (policy wiring), 329 (monitors), 333 (idempotent deduction). Refuses to apply without them.
-- ROLLBACK: rollback/335_financial_exceptions_ROLLBACK.sql (restores the exact 329 fn_fin_monitor_all body, drops the rest;
--   refuses while OPEN exceptions exist so no unresolved record is ever destroyed silently).
-- STATUS: PENDING (migrations_pending). Applied to the LOCAL disposable database only.

DO $chk$
BEGIN
  IF to_regprocedure('fn_posting_date_for_event(uuid,text,timestamp with time zone,date)') IS NULL THEN
    RAISE EXCEPTION '335 requires migrations 325-328 (fn_posting_date_for_event is missing)';
  END IF;
  IF to_regprocedure('fn_fin_monitor_all(uuid,interval,interval)') IS NULL OR to_regprocedure('fn_fin_monitor_m9_cancel_asymmetry(uuid,interval,interval)') IS NULL THEN
    RAISE EXCEPTION '335 requires migration 329 (financial monitors are missing)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fn_process_sale_stock_deduction' AND pronamespace = 'public'::regnamespace
                  AND prosrc LIKE '%sale_stock_deduct:%') THEN
    RAISE EXCEPTION '335 requires migration 333 (idempotent sale stock deduction is missing)';
  END IF;
END
$chk$;

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS financial_exceptions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id),
  kind               TEXT NOT NULL CHECK (kind IN ('stock_deduction_failed', 'cogs_missing', 'restock_failed')),
  source_entity_type TEXT NOT NULL,             -- 'order'
  source_entity_id   UUID NOT NULL,             -- the order id
  line_ref           UUID,                      -- an order_items.id of the failing line (first of the item/variant group)
  item_id            UUID,
  variant_id         UUID,
  quantity           NUMERIC,
  warehouse_id       UUID,
  dedupe_key         TEXT NOT NULL,             -- kind|source type|source id|item|variant : the same failure is recorded once
  error_text         TEXT,
  status             TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  attempts           INTEGER NOT NULL DEFAULT 0,
  last_attempt_at    TIMESTAMPTZ,
  last_error         TEXT,
  catchup_entry_id   UUID,                      -- the COGS catch-up journal entry, when one was posted
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at        TIMESTAMPTZ,
  resolved_by        UUID,
  resolution_note    TEXT,
  db_role            TEXT NOT NULL DEFAULT current_user,
  CONSTRAINT uq_financial_exceptions_dedupe UNIQUE (tenant_id, dedupe_key),
  CONSTRAINT chk_financial_exceptions_resolved CHECK ((status = 'open' AND resolved_at IS NULL) OR (status = 'resolved' AND resolved_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_financial_exceptions_open   ON financial_exceptions (tenant_id, created_at) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_financial_exceptions_source ON financial_exceptions (tenant_id, source_entity_id);

ALTER TABLE financial_exceptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_session_isolation ON financial_exceptions;
CREATE POLICY tenant_session_isolation ON financial_exceptions
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid)
  WITH CHECK (tenant_id = (current_setting('app.tenant_id', true))::uuid);

-- The journal engine only accepts entries whose (source_module, source_entity_type) is registered in the global catalog
-- (fk_journal_entries_source). Register the catch-up type (same pattern as 253 for 'sales_return').
INSERT INTO financial_event_source_types (source_module, source_entity_type, label)
VALUES ('sales', 'order_cogs_catchup', 'Sales COGS catch-up')
ON CONFLICT (source_module, source_entity_type) DO NOTHING;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Per-line deduction. Same arithmetic as the loop body of fn_process_sale_stock_deduction (333), but for ONE line and
--    idempotent per (order, item, variant). It takes the SAME advisory lock as 333, so it serialises with a whole-order call.
--    Returns 'deducted' | 'already' | 'no_inventory'.
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_process_sale_stock_deduction_line(
  p_tenant_id uuid, p_warehouse_id uuid, p_order_id uuid, p_actor_id uuid, p_item_id uuid, p_variant_id uuid, p_quantity numeric)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_has_inventory BOOLEAN;
  v_unit_cost NUMERIC;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('sale_stock_deduct:' || p_order_id::text, 0));
  IF EXISTS (SELECT 1 FROM stock_movements
              WHERE tenant_id = p_tenant_id AND reference_type = 'order' AND reference_id = p_order_id AND movement_type = 'sale'
                AND item_id = p_item_id AND variant_id IS NOT DISTINCT FROM p_variant_id)
     OR EXISTS (SELECT 1 FROM backorders
                 WHERE tenant_id = p_tenant_id AND order_id = p_order_id
                   AND item_id = p_item_id AND variant_id IS NOT DISTINCT FROM p_variant_id) THEN
    RETURN 'already';
  END IF;

  SELECT has_inventory INTO v_has_inventory FROM items WHERE id = p_item_id;
  IF NOT COALESCE(v_has_inventory, false) THEN
    RETURN 'no_inventory';
  END IF;

  v_unit_cost := fn_consume_cost_layers(
    p_tenant_id, p_warehouse_id, p_item_id, p_variant_id, p_quantity,
    true -- p_allow_partial: shortfall becomes a backorder, not a hard failure
  );

  PERFORM fn_apply_stock_movement(
    p_tenant_id, p_warehouse_id, NULL, p_item_id, p_variant_id, NULL,
    'sale', 'out', p_quantity, v_unit_cost,
    'order', p_order_id, p_actor_id,
    false, -- p_allow_negative
    true   -- p_allow_backorder
  );
  RETURN 'deducted';
END;
$function$;

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Idempotent recorder. Returns the id of the (new or already existing) exception row.
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_record_financial_exception(
  p_tenant_id uuid, p_kind text, p_source_entity_type text, p_source_entity_id uuid, p_line_ref uuid,
  p_item_id uuid, p_variant_id uuid, p_quantity numeric, p_warehouse_id uuid, p_error text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id  UUID;
  v_key TEXT := concat_ws('|', p_kind, p_source_entity_type, p_source_entity_id::text, coalesce(p_item_id::text, '-'), coalesce(p_variant_id::text, '-'));
BEGIN
  INSERT INTO financial_exceptions (tenant_id, kind, source_entity_type, source_entity_id, line_ref, item_id, variant_id, quantity,
                                    warehouse_id, dedupe_key, error_text)
  VALUES (p_tenant_id, p_kind, p_source_entity_type, p_source_entity_id, p_line_ref, p_item_id, p_variant_id, p_quantity,
          p_warehouse_id, v_key, left(p_error, 2000))
  ON CONFLICT (tenant_id, dedupe_key) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM financial_exceptions WHERE tenant_id = p_tenant_id AND dedupe_key = v_key;
  END IF;
  RETURN v_id;
END;
$function$;

-- ---------------------------------------------------------------------------------------------------------------
-- 4a. Retry ONE exception. Returns jsonb {status, ...}:
--       resolved | already_resolved | not_found | refused_closed_period | failed
--     Atomic: the deduction, the catch-up entry and the resolve either all happen or none (sub-transaction), so it can never
--     deduct without recording, nor post COGS without the stock. The row lock (FOR UPDATE) makes a concurrent second call wait,
--     then see 'resolved' (no-op): exactly one winner.
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_financial_exception_retry(p_exception_id uuid, p_actor_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ex             financial_exceptions%ROWTYPE;
  v_order          RECORD;
  v_sale_entry     RECORD;
  v_period_status  TEXT;
  v_cogs_acct      UUID;
  v_inventory_acct UUID;
  v_amount         NUMERIC(14,2);
  v_raw_cost       NUMERIC;
  v_other_catchup  NUMERIC;
  v_catchup_id     UUID;
  v_line_result    TEXT;
  v_note           TEXT;
BEGIN
  SELECT * INTO v_ex FROM financial_exceptions WHERE id = p_exception_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  IF v_ex.status = 'resolved' THEN
    RETURN jsonb_build_object('status', 'already_resolved', 'catchup_entry_id', v_ex.catchup_entry_id);
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = v_ex.source_entity_id AND tenant_id = v_ex.tenant_id;

  -- Closed-period guard BEFORE any write: the catch-up COGS goes to the sale's own posting date and period.
  IF v_ex.kind IN ('stock_deduction_failed', 'cogs_missing') THEN
    SELECT je.posting_date INTO v_sale_entry FROM journal_entries je
     WHERE je.tenant_id = v_ex.tenant_id AND je.source_module = 'sales' AND je.source_entity_type = 'order'
       AND je.source_entity_id = v_ex.source_entity_id AND je.reversal_of_id IS NULL;
    IF FOUND AND v_order.status = 'completed' THEN
      SELECT fp.status INTO v_period_status FROM fiscal_periods fp
       WHERE fp.tenant_id = v_ex.tenant_id AND daterange(fp.start_date, fp.end_date, '[)') @> v_sale_entry.posting_date;
      IF v_period_status IS NOT NULL AND v_period_status <> 'open' THEN
        UPDATE financial_exceptions
           SET attempts = attempts + 1, last_attempt_at = now(),
               last_error = 'refused: fiscal period of the sale (' || v_sale_entry.posting_date || ') is ' || v_period_status
         WHERE id = v_ex.id;
        RETURN jsonb_build_object('status', 'refused_closed_period', 'period_status', v_period_status);
      END IF;
    END IF;
  END IF;

  BEGIN
    IF v_ex.kind = 'restock_failed' THEN
      PERFORM fn_reverse_sale_stock_deduction(v_ex.tenant_id, v_ex.source_entity_id, p_actor_id);
      v_note := 'restock replayed (idempotent per order)';

    ELSE
      IF v_order.id IS NULL THEN
        RAISE EXCEPTION 'order % not found', v_ex.source_entity_id;
      END IF;
      IF v_order.status <> 'completed' THEN
        -- cancelled (or otherwise no longer a completed sale): there is nothing to catch up
        UPDATE financial_exceptions
           SET status = 'resolved', resolved_at = now(), resolved_by = p_actor_id, attempts = attempts + 1, last_attempt_at = now(),
               last_error = NULL, resolution_note = 'order is ' || v_order.status || ': no catch-up needed'
         WHERE id = v_ex.id;
        RETURN jsonb_build_object('status', 'resolved', 'note', 'order_not_completed');
      END IF;

      SELECT * INTO v_sale_entry FROM journal_entries je
       WHERE je.tenant_id = v_ex.tenant_id AND je.source_module = 'sales' AND je.source_entity_type = 'order'
         AND je.source_entity_id = v_ex.source_entity_id AND je.reversal_of_id IS NULL;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'order % has no sales journal entry to catch up against', v_ex.source_entity_id;
      END IF;

      IF v_ex.kind = 'stock_deduction_failed' THEN
        v_line_result := fn_process_sale_stock_deduction_line(
          v_ex.tenant_id, v_ex.warehouse_id, v_ex.source_entity_id, p_actor_id, v_ex.item_id, v_ex.variant_id, v_ex.quantity);
      END IF;

      -- Cost created AFTER the sale's own entry (movements written in the sale transaction share its timestamp and are already
      -- inside that entry). stock_deduction_failed looks at its own item/variant; cogs_missing at the whole order minus the
      -- catch-up already posted for other exceptions of the order.
      SELECT coalesce(sum(m.total_cost), 0) INTO v_raw_cost FROM stock_movements m
       WHERE m.tenant_id = v_ex.tenant_id AND m.reference_type = 'order' AND m.reference_id = v_ex.source_entity_id
         AND m.movement_type = 'sale' AND m.created_at > v_sale_entry.created_at
         AND (v_ex.item_id IS NULL OR (m.item_id = v_ex.item_id AND m.variant_id IS NOT DISTINCT FROM v_ex.variant_id));
      IF v_ex.item_id IS NULL THEN
        SELECT coalesce(sum(jl.debit_amount), 0) INTO v_other_catchup
          FROM journal_entries je
          JOIN journal_lines jl ON jl.journal_entry_id = je.id AND jl.debit_amount > 0
         WHERE je.tenant_id = v_ex.tenant_id AND je.source_module = 'sales' AND je.source_entity_type = 'order_cogs_catchup'
           AND je.reversal_of_id IS NULL AND je.status = 'posted'
           AND je.source_entity_id IN (SELECT fe.id FROM financial_exceptions fe WHERE fe.tenant_id = v_ex.tenant_id AND fe.source_entity_id = v_ex.source_entity_id);
        v_raw_cost := v_raw_cost - v_other_catchup;
      END IF;
      v_amount := round(v_raw_cost, 2);

      IF v_amount > 0 THEN
        SELECT je.id INTO v_catchup_id FROM journal_entries je
         WHERE je.tenant_id = v_ex.tenant_id AND je.source_module = 'sales' AND je.source_entity_type = 'order_cogs_catchup'
           AND je.source_entity_id = v_ex.id AND je.reversal_of_id IS NULL;
        IF v_catchup_id IS NULL THEN
          SELECT account_id INTO v_cogs_acct FROM account_role_assignments WHERE tenant_id = v_ex.tenant_id AND role_code = 'cogs';
          SELECT account_id INTO v_inventory_acct FROM account_role_assignments WHERE tenant_id = v_ex.tenant_id AND role_code = 'inventory_asset';
          IF v_cogs_acct IS NULL OR v_inventory_acct IS NULL THEN
            RAISE EXCEPTION 'tenant % has no cogs / inventory_asset account role', v_ex.tenant_id;
          END IF;
          INSERT INTO journal_entries (tenant_id, accounting_book_id, posting_date, document_date, reference, description,
                                       source_module, source_entity_type, source_entity_id, created_by)
          VALUES (v_ex.tenant_id, v_sale_entry.accounting_book_id, v_sale_entry.posting_date, v_sale_entry.posting_date,
                  v_ex.source_entity_id::text, NULL, 'sales', 'order_cogs_catchup', v_ex.id, p_actor_id)
          RETURNING id INTO v_catchup_id;
          INSERT INTO journal_lines (tenant_id, journal_entry_id, line_number, account_id, debit_amount, credit_amount)
          VALUES (v_ex.tenant_id, v_catchup_id, 1, v_cogs_acct, v_amount, 0),
                 (v_ex.tenant_id, v_catchup_id, 2, v_inventory_acct, 0, v_amount);
          PERFORM fn_post_journal_entry(v_ex.tenant_id, v_catchup_id, p_actor_id);
        END IF;
        v_note := 'catch-up COGS ' || v_amount || ' posted';
      ELSE
        v_catchup_id := NULL;
        v_note := 'no cost to post (' || coalesce(v_line_result, 'order level') || ')';
      END IF;
    END IF;

    UPDATE financial_exceptions
       SET status = 'resolved', resolved_at = now(), resolved_by = p_actor_id, attempts = attempts + 1, last_attempt_at = now(),
           last_error = NULL, catchup_entry_id = v_catchup_id, resolution_note = v_note
     WHERE id = v_ex.id;
    RETURN jsonb_build_object('status', 'resolved', 'catchup_entry_id', v_catchup_id, 'amount', v_amount, 'note', v_note);
  EXCEPTION WHEN OTHERS THEN
    -- the sub-transaction above (deduction, entry, resolve) is rolled back as a unit; only the attempt is recorded
    UPDATE financial_exceptions
       SET attempts = attempts + 1, last_attempt_at = now(), last_error = left(SQLERRM, 2000)
     WHERE id = v_ex.id;
    RETURN jsonb_build_object('status', 'failed', 'error', SQLERRM);
  END;
END;
$function$;

-- ---------------------------------------------------------------------------------------------------------------
-- 4b. Batch: oldest open exceptions first, at most p_limit, rows locked by another worker are skipped.
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_financial_exception_retry_batch(
  p_limit integer DEFAULT 50, p_tenant_id uuid DEFAULT NULL, p_actor_id uuid DEFAULT NULL)
 RETURNS TABLE (exception_id uuid, status text, detail jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
  v jsonb;
BEGIN
  FOR r IN
    SELECT fe.id AS fid FROM financial_exceptions fe
     WHERE fe.status = 'open' AND (p_tenant_id IS NULL OR fe.tenant_id = p_tenant_id)
     ORDER BY fe.created_at, fe.id
     LIMIT greatest(coalesce(p_limit, 50), 0)
       FOR UPDATE SKIP LOCKED
  LOOP
    v := fn_financial_exception_retry(r.fid, p_actor_id);
    exception_id := r.fid;
    status := v->>'status';
    detail := v;
    RETURN NEXT;
  END LOOP;
END;
$function$;

-- ---------------------------------------------------------------------------------------------------------------
-- 5. Cancel hygiene (called inside the pooled cancel transaction when recording is enabled): close the order's open
--    stock/COGS exceptions (the sale is void) and reverse any catch-up COGS entry posted for it, so cancelling an order whose
--    failed line was later caught up never leaves phantom COGS behind. Returns the number of entries reversed.
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_financial_exception_on_order_cancel(
  p_tenant_id uuid, p_order_id uuid, p_actor_id uuid, p_posting_date date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
  v_n INTEGER := 0;
BEGIN
  FOR r IN
    SELECT je.id AS jid FROM journal_entries je
     WHERE je.tenant_id = p_tenant_id AND je.source_module = 'sales' AND je.source_entity_type = 'order_cogs_catchup'
       AND je.reversal_of_id IS NULL AND je.status = 'posted'
       AND je.source_entity_id IN (SELECT fe.id FROM financial_exceptions fe WHERE fe.tenant_id = p_tenant_id AND fe.source_entity_id = p_order_id)
       AND NOT EXISTS (SELECT 1 FROM journal_entries rv WHERE rv.reversal_of_id = je.id AND rv.tenant_id = p_tenant_id)
  LOOP
    PERFORM fn_reverse_journal_entry(p_tenant_id, r.jid, p_actor_id, p_posting_date, 'Order cancelled (catch-up COGS)');
    v_n := v_n + 1;
  END LOOP;
  UPDATE financial_exceptions
     SET status = 'resolved', resolved_at = now(), resolved_by = p_actor_id,
         resolution_note = 'order cancelled: no catch-up needed'
   WHERE tenant_id = p_tenant_id AND source_entity_id = p_order_id AND status = 'open'
     AND kind IN ('stock_deduction_failed', 'cogs_missing');
  RETURN v_n;
END;
$function$;

-- ---------------------------------------------------------------------------------------------------------------
-- 6. Monitor M-10 (high): open financial exceptions. Same uniform shape as M-1..M-9. fn_fin_monitor_all gains one UNION ALL
--    line (the 329 body is otherwise identical); fn_fin_monitor_summary is untouched and picks M-10 up through it.
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_fin_monitor_m10_open_exceptions(
  p_tenant_id uuid DEFAULT NULL, p_grace interval DEFAULT '5 minutes', p_lookback interval DEFAULT '90 days')
RETURNS TABLE (check_id text, severity text, tenant_id uuid, subject_type text, subject_id uuid,
               occurred_at timestamptz, amount numeric, detail jsonb)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT 'M-10'::text, 'high'::text, fe.tenant_id, 'financial_exception'::text, fe.id, fe.created_at, NULL::numeric,
         jsonb_build_object('kind', fe.kind, 'source_entity_type', fe.source_entity_type, 'source_entity_id', fe.source_entity_id,
                            'item_id', fe.item_id, 'attempts', fe.attempts, 'last_error', fe.last_error)
    FROM financial_exceptions fe
   WHERE fe.status = 'open'
     AND (p_tenant_id IS NULL OR fe.tenant_id = p_tenant_id)
$$;

CREATE OR REPLACE FUNCTION fn_fin_monitor_all(
  p_tenant_id uuid DEFAULT NULL, p_grace interval DEFAULT '5 minutes', p_lookback interval DEFAULT '90 days')
RETURNS TABLE (check_id text, severity text, tenant_id uuid, subject_type text, subject_id uuid,
               occurred_at timestamptz, amount numeric, detail jsonb)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT * FROM fn_fin_monitor_m1_orders_without_entry(p_tenant_id, p_grace, p_lookback)
  UNION ALL SELECT * FROM fn_fin_monitor_m2_cogs_reconciliation(p_tenant_id, p_grace, p_lookback)
  UNION ALL SELECT * FROM fn_fin_monitor_m3_orders_missing_movements(p_tenant_id, p_grace, p_lookback)
  UNION ALL SELECT * FROM fn_fin_monitor_m4_movements_without_journal(p_tenant_id, p_grace, p_lookback)
  UNION ALL SELECT * FROM fn_fin_monitor_m5_stock_level_drift(p_tenant_id)
  UNION ALL SELECT * FROM fn_fin_monitor_m6_inventory_vs_ledger(p_tenant_id)
  UNION ALL SELECT * FROM fn_fin_monitor_m7_fiscal_coverage(p_tenant_id)
  UNION ALL SELECT * FROM fn_fin_monitor_m8_duplicate_or_unnumbered(p_tenant_id, p_grace, p_lookback)
  UNION ALL SELECT * FROM fn_fin_monitor_m9_cancel_asymmetry(p_tenant_id, p_grace, p_lookback)
  UNION ALL SELECT * FROM fn_fin_monitor_m10_open_exceptions(p_tenant_id, p_grace, p_lookback)
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Grants: Supabase default privileges hand new objects to anon/authenticated. service_role only.
-- ---------------------------------------------------------------------------------------------------------------
REVOKE ALL ON financial_exceptions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON financial_exceptions TO service_role;
DO $grants$
DECLARE r regprocedure;
BEGIN
  FOR r IN SELECT p.oid::regprocedure FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname IN ('fn_process_sale_stock_deduction_line', 'fn_record_financial_exception', 'fn_financial_exception_retry',
                                'fn_financial_exception_retry_batch', 'fn_financial_exception_on_order_cancel',
                                'fn_fin_monitor_m10_open_exceptions', 'fn_fin_monitor_all')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r);
  END LOOP;
END
$grants$;
