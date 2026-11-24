-- 329_financial_monitoring.sql — WP-D: read-only monitor / reconciliation queries M-1 .. M-9 for the sale, inventory
-- and accounting path.
--
-- STATUS: PENDING (migrations_pending). Applied to the LOCAL disposable database only. Additive: functions only; no table,
-- column, trigger, policy or existing function is created, altered or dropped.
--
-- READ-ONLY BY CONSTRUCTION: every function is LANGUAGE sql STABLE (the planner refuses writes inside a STABLE function),
-- contains only SELECT, and EXECUTE is granted to service_role ONLY (revoked from PUBLIC, anon, authenticated).
-- The spec financial-monitoring-329.regression.spec.ts additionally runs them inside BEGIN READ ONLY under SET ROLE service_role.
--
-- Uniform result shape for every check, so a metric/notification job (WP-B for M-7, WP-E for M-3) can consume them blindly:
--   check_id text, severity text, tenant_id uuid, subject_type text, subject_id uuid, occurred_at timestamptz,
--   amount numeric, detail jsonb
--
-- Common parameters:
--   p_tenant_id uuid     NULL = every tenant (use a tenant id on large databases)
--   p_grace interval     ignore things younger than this: the pooled sale with POOLED_STOCK_IN_TX_ENABLED=false deducts stock
--                        AFTER commit, so a brand-new sale legitimately has no movements for a moment (default 5 minutes)
--   p_lookback interval  only look at the last N (default 90 days) for the row-per-order checks (cost control)
--
-- M-5 and M-6 compare whole balances (no time window); give them a tenant id on big databases.
--
-- ROLLBACK: rollback/329_financial_monitoring_ROLLBACK.sql (drops exactly the functions below).
-- DEPENDS ON: 325 (v_fiscal_coverage / fn_fiscal_coverage_alerts) for M-7 only; this file refuses to apply without it.

DO $chk$
BEGIN
  IF to_regprocedure('fn_fiscal_coverage_alerts(integer)') IS NULL THEN
    RAISE EXCEPTION '329 requires migration 325 (fn_fiscal_coverage_alerts is missing)';
  END IF;
END
$chk$;

-- ---------------------------------------------------------------------------------------------------------------
-- M-1 (critical): completed orders without a sales journal entry.
--   Free orders (total, net revenue and tax all 0) legitimately post nothing (266) and are excluded.
--   Catches: the legacy non-pooled path (flags off), a dine-in checkout, any order whose posting never happened.
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_fin_monitor_m1_orders_without_entry(
  p_tenant_id uuid DEFAULT NULL, p_grace interval DEFAULT '5 minutes', p_lookback interval DEFAULT '90 days')
RETURNS TABLE (check_id text, severity text, tenant_id uuid, subject_type text, subject_id uuid,
               occurred_at timestamptz, amount numeric, detail jsonb)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT 'M-1'::text, 'critical'::text, o.tenant_id, 'order'::text, o.id, o.created_at, o.total,
         jsonb_build_object('branch_id', o.branch_id, 'invoice_no', o.invoice_no, 'payment_method', o.payment_method)
    FROM orders o
   WHERE o.status = 'completed'
     AND o.deleted_at IS NULL
     AND COALESCE(o.held, false) = false
     AND (p_tenant_id IS NULL OR o.tenant_id = p_tenant_id)
     AND o.created_at < now() - p_grace
     AND o.created_at >= now() - p_lookback
     AND NOT (COALESCE(o.total, 0) <= 0 AND COALESCE(o.subtotal, 0) - COALESCE(o.discount, 0) <= 0 AND COALESCE(o.tax, 0) <= 0)
     AND NOT EXISTS (
           SELECT 1 FROM journal_entries je
            WHERE je.tenant_id = o.tenant_id AND je.source_module = 'sales' AND je.source_entity_type = 'order'
              AND je.source_entity_id = o.id AND je.reversal_of_id IS NULL)
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- M-2 (high): journal entries flagged requires_cogs_reconciliation (M194): a tracked item was sold but no inventory cost
--   reached the entry (stock-in-tx off, stock failure swallowed in the savepoint, no cost layers, backorder).
--   amount = the sale-movement cost that exists for the order (cost that is NOT in the ledger); 0 when nothing was deducted.
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_fin_monitor_m2_cogs_reconciliation(
  p_tenant_id uuid DEFAULT NULL, p_grace interval DEFAULT '5 minutes', p_lookback interval DEFAULT '90 days')
RETURNS TABLE (check_id text, severity text, tenant_id uuid, subject_type text, subject_id uuid,
               occurred_at timestamptz, amount numeric, detail jsonb)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT 'M-2'::text, 'high'::text, je.tenant_id, 'journal_entry'::text, je.id, je.created_at,
         CASE WHEN je.source_entity_type = 'order'
              THEN (SELECT COALESCE(sum(m.total_cost), 0) FROM stock_movements m
                     WHERE m.tenant_id = je.tenant_id AND m.reference_type = 'order'
                       AND m.reference_id = je.source_entity_id AND m.movement_type = 'sale')
              ELSE 0 END,
         jsonb_build_object('source_entity_type', je.source_entity_type, 'source_entity_id', je.source_entity_id,
                            'posting_date', je.posting_date)
    FROM journal_entries je
   WHERE je.requires_cogs_reconciliation = true
     AND je.reversal_of_id IS NULL
     AND (p_tenant_id IS NULL OR je.tenant_id = p_tenant_id)
     AND je.created_at < now() - p_grace
     AND je.created_at >= now() - p_lookback
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- M-3 (high): completed orders where a stock-tracked line has NEITHER a sale movement NOR a backorder row
--   (a partial / swallowed stock failure, or the deduction never ran). Lines are compared per distinct (item, variant);
--   a fully backordered line writes no movement by design (219) and is therefore accepted when a backorders row exists.
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_fin_monitor_m3_orders_missing_movements(
  p_tenant_id uuid DEFAULT NULL, p_grace interval DEFAULT '5 minutes', p_lookback interval DEFAULT '90 days')
RETURNS TABLE (check_id text, severity text, tenant_id uuid, subject_type text, subject_id uuid,
               occurred_at timestamptz, amount numeric, detail jsonb)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT 'M-3'::text, 'high'::text, o.tenant_id, 'order'::text, o.id, o.created_at, NULL::numeric,
         jsonb_build_object('tracked_lines', t.tracked, 'lines_without_movement', t.missing)
    FROM orders o
    JOIN LATERAL (
           SELECT count(*) AS tracked, count(*) FILTER (WHERE NOT x.has_mv AND NOT x.has_bo) AS missing
             FROM (
                    SELECT DISTINCT oi.item_id, oi.variant_id,
                           EXISTS (SELECT 1 FROM stock_movements m
                                    WHERE m.tenant_id = o.tenant_id AND m.reference_type = 'order' AND m.reference_id = o.id
                                      AND m.movement_type = 'sale' AND m.item_id = oi.item_id
                                      AND m.variant_id IS NOT DISTINCT FROM oi.variant_id) AS has_mv,
                           EXISTS (SELECT 1 FROM backorders b
                                    WHERE b.tenant_id = o.tenant_id AND b.order_id = o.id AND b.item_id = oi.item_id
                                      AND b.variant_id IS NOT DISTINCT FROM oi.variant_id) AS has_bo
                      FROM order_items oi
                      JOIN items i ON i.id = oi.item_id AND i.tenant_id = o.tenant_id AND i.has_inventory = true
                     WHERE oi.order_id = o.id AND oi.deleted_at IS NULL
                  ) x
         ) t ON t.missing > 0
   WHERE o.status = 'completed'
     AND o.deleted_at IS NULL
     AND COALESCE(o.held, false) = false
     AND (p_tenant_id IS NULL OR o.tenant_id = p_tenant_id)
     AND o.created_at < now() - p_grace
     AND o.created_at >= now() - p_lookback
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- M-4: stock movements that carry cost but have no journal source.
--   'high' : a SALE movement (cost > 0) whose order has no sales entry (the cost never reached the ledger).
--   'info' : one aggregate row per tenant and movement type for the types that post nothing BY DESIGN today
--            (receipt, adjustments, count corrections, transfers, returns restock...). Expect these until Phase 2 events.
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_fin_monitor_m4_movements_without_journal(
  p_tenant_id uuid DEFAULT NULL, p_grace interval DEFAULT '5 minutes', p_lookback interval DEFAULT '90 days')
RETURNS TABLE (check_id text, severity text, tenant_id uuid, subject_type text, subject_id uuid,
               occurred_at timestamptz, amount numeric, detail jsonb)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT 'M-4'::text, 'high'::text, m.tenant_id, 'stock_movement'::text, m.id, m.created_at, m.total_cost,
         jsonb_build_object('movement_type', m.movement_type, 'order_id', m.reference_id)
    FROM stock_movements m
   WHERE m.movement_type = 'sale' AND m.reference_type = 'order' AND m.total_cost > 0
     AND (p_tenant_id IS NULL OR m.tenant_id = p_tenant_id)
     AND m.created_at < now() - p_grace
     AND m.created_at >= now() - p_lookback
     AND NOT EXISTS (
           SELECT 1 FROM journal_entries je
            WHERE je.tenant_id = m.tenant_id AND je.source_module = 'sales' AND je.source_entity_type = 'order'
              AND je.source_entity_id = m.reference_id AND je.reversal_of_id IS NULL)
  UNION ALL
  SELECT 'M-4'::text, 'info'::text, m.tenant_id, 'movement_type'::text, NULL::uuid, max(m.created_at), sum(m.total_cost),
         jsonb_build_object('movement_type', m.movement_type, 'movements', count(*))
    FROM stock_movements m
   WHERE m.total_cost > 0 AND m.movement_type <> 'sale'
     AND (p_tenant_id IS NULL OR m.tenant_id = p_tenant_id)
     AND m.created_at >= now() - p_lookback
   GROUP BY m.tenant_id, m.movement_type
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- M-5 (high): stock_levels.quantity_on_hand vs the signed sum of movements per stock point
--   (tenant, warehouse, location, item, variant, batch). damage / expiry / quality_hold / quality_release move other
--   counters, not on-hand, and are excluded. Stock that exists without any movement (opening balances written directly)
--   shows up here by design: that is unexplained stock.
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_fin_monitor_m5_stock_level_drift(p_tenant_id uuid DEFAULT NULL)
RETURNS TABLE (check_id text, severity text, tenant_id uuid, subject_type text, subject_id uuid,
               occurred_at timestamptz, amount numeric, detail jsonb)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH mv AS (
    SELECT m.tenant_id, m.warehouse_id,
           COALESCE(m.location_id, '00000000-0000-0000-0000-000000000000'::uuid) AS loc,
           m.item_id,
           COALESCE(m.variant_id, '00000000-0000-0000-0000-000000000000'::uuid) AS var,
           COALESCE(m.batch_id, '00000000-0000-0000-0000-000000000000'::uuid) AS bat,
           sum(CASE m.direction WHEN 'in' THEN m.quantity ELSE -m.quantity END) AS net
      FROM stock_movements m
     WHERE m.movement_type NOT IN ('damage', 'expiry', 'quality_hold', 'quality_release')
       AND (p_tenant_id IS NULL OR m.tenant_id = p_tenant_id)
     GROUP BY 1, 2, 3, 4, 5, 6
  ), lv AS (
    SELECT l.id, l.tenant_id, l.warehouse_id,
           COALESCE(l.location_id, '00000000-0000-0000-0000-000000000000'::uuid) AS loc,
           l.item_id,
           COALESCE(l.variant_id, '00000000-0000-0000-0000-000000000000'::uuid) AS var,
           COALESCE(l.batch_id, '00000000-0000-0000-0000-000000000000'::uuid) AS bat,
           l.quantity_on_hand, l.updated_at
      FROM stock_levels l
     WHERE (p_tenant_id IS NULL OR l.tenant_id = p_tenant_id)
  )
  SELECT 'M-5'::text, 'high'::text, COALESCE(lv.tenant_id, mv.tenant_id), 'stock_level'::text, lv.id, lv.updated_at,
         (COALESCE(lv.quantity_on_hand, 0) - COALESCE(mv.net, 0))::numeric,
         jsonb_build_object('warehouse_id', COALESCE(lv.warehouse_id, mv.warehouse_id),
                            'item_id', COALESCE(lv.item_id, mv.item_id),
                            'on_hand', COALESCE(lv.quantity_on_hand, 0),
                            'movement_sum', COALESCE(mv.net, 0),
                            'has_level_row', lv.id IS NOT NULL)
    FROM lv
    FULL JOIN mv ON mv.tenant_id = lv.tenant_id AND mv.warehouse_id = lv.warehouse_id AND mv.loc = lv.loc
                AND mv.item_id = lv.item_id AND mv.var = lv.var AND mv.bat = lv.bat
   WHERE abs(COALESCE(lv.quantity_on_hand, 0) - COALESCE(mv.net, 0)) > 0.0001
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- M-6 (info): inventory-asset ledger balance (debit - credit over posted/reversed entries on the account mapped to the
--   inventory_asset role) vs the value of the open cost layers, per tenant. Until receipts/adjustments/transfers post to the
--   ledger (Phase 2) a delta is EXPECTED: delta = -(receipts + other inbound value not posted) - (COGS booked at standard
--   cost vs layer cost). Informational; useful as a trend and to prove the delta stays explained.
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_fin_monitor_m6_inventory_vs_ledger(p_tenant_id uuid DEFAULT NULL)
RETURNS TABLE (check_id text, severity text, tenant_id uuid, subject_type text, subject_id uuid,
               occurred_at timestamptz, amount numeric, detail jsonb)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH led AS (
    SELECT jl.tenant_id, sum(jl.debit_amount - jl.credit_amount) AS bal
      FROM journal_lines jl
      JOIN journal_entries je ON je.tenant_id = jl.tenant_id AND je.id = jl.journal_entry_id AND je.status IN ('posted', 'reversed')
      JOIN account_role_assignments ara ON ara.tenant_id = jl.tenant_id AND ara.role_code = 'inventory_asset' AND ara.account_id = jl.account_id
     WHERE (p_tenant_id IS NULL OR jl.tenant_id = p_tenant_id)
     GROUP BY jl.tenant_id
  ), lay AS (
    SELECT cl.tenant_id, sum(cl.quantity_remaining * cl.unit_cost) AS val
      FROM cost_layers cl
     WHERE cl.quantity_remaining > 0 AND (p_tenant_id IS NULL OR cl.tenant_id = p_tenant_id)
     GROUP BY cl.tenant_id
  )
  SELECT 'M-6'::text, 'info'::text, COALESCE(led.tenant_id, lay.tenant_id), 'tenant'::text, COALESCE(led.tenant_id, lay.tenant_id),
         now(), (COALESCE(led.bal, 0) - COALESCE(lay.val, 0))::numeric,
         jsonb_build_object('ledger_inventory_balance', COALESCE(led.bal, 0), 'cost_layer_value', COALESCE(lay.val, 0))
    FROM led FULL JOIN lay ON lay.tenant_id = led.tenant_id
   WHERE abs(COALESCE(led.bal, 0) - COALESCE(lay.val, 0)) >= 0.005
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- M-7: fiscal coverage — reuses 325 (v_fiscal_coverage via fn_fiscal_coverage_alerts). Tenants whose fiscal calendar ends
--   within p_threshold_days. expired / <=30 days = critical, <=90 = high, else medium. amount = days_remaining.
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_fin_monitor_m7_fiscal_coverage(p_tenant_id uuid DEFAULT NULL, p_threshold_days integer DEFAULT 180)
RETURNS TABLE (check_id text, severity text, tenant_id uuid, subject_type text, subject_id uuid,
               occurred_at timestamptz, amount numeric, detail jsonb)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT 'M-7'::text,
         CASE a.severity WHEN 'expired' THEN 'critical' WHEN 'critical' THEN 'critical' WHEN 'high' THEN 'high' ELSE 'medium' END,
         a.tenant_id, 'tenant'::text, a.tenant_id, now(), a.days_remaining::numeric,
         jsonb_build_object('covered_until', a.covered_until, 'coverage_severity', a.severity)
    FROM fn_fiscal_coverage_alerts(p_threshold_days) a
   WHERE p_tenant_id IS NULL OR a.tenant_id = p_tenant_id
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- M-8 (medium): (a) near-duplicate sales: same tenant, branch, cashier, payment method, total AND identical item lines,
--   created within p_dup_window of each other under DIFFERENT sale_attempt_id (a double submit that slipped past the
--   idempotency key); (b) completed orders without an invoice number although the tenant already issues numbers
--   (an order created after the tenant's first numbered order). One row per later order of a duplicate pair.
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_fin_monitor_m8_duplicate_or_unnumbered(
  p_tenant_id uuid DEFAULT NULL, p_grace interval DEFAULT '5 minutes', p_lookback interval DEFAULT '90 days',
  p_dup_window interval DEFAULT '20 seconds')
RETURNS TABLE (check_id text, severity text, tenant_id uuid, subject_type text, subject_id uuid,
               occurred_at timestamptz, amount numeric, detail jsonb)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH recent AS (
    SELECT o.id, o.tenant_id, o.branch_id, o.cashier_id, o.payment_method, o.total, o.created_at, o.invoice_no, o.sale_attempt_id,
           (SELECT string_agg(oi.item_id::text || ':' || oi.qty::text || ':' || oi.price::text, ',' ORDER BY oi.item_id, oi.qty, oi.price)
              FROM order_items oi WHERE oi.order_id = o.id AND oi.deleted_at IS NULL) AS sig
      FROM orders o
     WHERE o.status = 'completed' AND o.deleted_at IS NULL AND COALESCE(o.held, false) = false
       AND (p_tenant_id IS NULL OR o.tenant_id = p_tenant_id)
       AND o.created_at >= now() - p_lookback
  )
  SELECT 'M-8'::text, 'medium'::text, b.tenant_id, 'order'::text, b.id, b.created_at, b.total,
         jsonb_build_object('kind', 'near_duplicate', 'duplicate_of', a.id, 'seconds_apart', extract(epoch FROM (b.created_at - a.created_at)))
    FROM recent a
    JOIN recent b ON b.tenant_id = a.tenant_id AND b.branch_id IS NOT DISTINCT FROM a.branch_id
                 AND b.cashier_id IS NOT DISTINCT FROM a.cashier_id AND b.payment_method IS NOT DISTINCT FROM a.payment_method
                 AND b.total = a.total AND b.sig IS NOT DISTINCT FROM a.sig AND b.sig IS NOT NULL
                 AND b.sale_attempt_id <> a.sale_attempt_id
                 AND b.created_at > a.created_at AND b.created_at <= a.created_at + p_dup_window
  UNION ALL
  SELECT 'M-8'::text, 'medium'::text, r.tenant_id, 'order'::text, r.id, r.created_at, r.total,
         jsonb_build_object('kind', 'missing_invoice_no')
    FROM recent r
   WHERE r.invoice_no IS NULL
     AND r.created_at < now() - p_grace
     AND EXISTS (SELECT 1 FROM orders n WHERE n.tenant_id = r.tenant_id AND n.invoice_no IS NOT NULL AND n.created_at < r.created_at)
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- M-9 (high, additional): cancelled orders whose ledger and stock do not reverse together:
--   (a) a sales entry that was never reversed, or (b) sale movements without an equal restock (the post-commit restock on
--   cancel is a separate best-effort call; when it fails the ledger is reversed but the stock stays deducted).
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_fin_monitor_m9_cancel_asymmetry(
  p_tenant_id uuid DEFAULT NULL, p_grace interval DEFAULT '5 minutes', p_lookback interval DEFAULT '90 days')
RETURNS TABLE (check_id text, severity text, tenant_id uuid, subject_type text, subject_id uuid,
               occurred_at timestamptz, amount numeric, detail jsonb)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT 'M-9'::text, 'high'::text, o.tenant_id, 'order'::text, o.id, o.cancelled_at, o.total,
         jsonb_build_object(
           'entry_not_reversed', EXISTS (SELECT 1 FROM journal_entries je
                                          WHERE je.tenant_id = o.tenant_id AND je.source_module = 'sales' AND je.source_entity_type = 'order'
                                            AND je.source_entity_id = o.id AND je.reversal_of_id IS NULL AND je.status = 'posted'),
           'qty_sold', s.q_sale, 'qty_restocked', s.q_back)
    FROM orders o
    CROSS JOIN LATERAL (
           SELECT COALESCE(sum(m.quantity) FILTER (WHERE m.movement_type = 'sale'), 0) AS q_sale,
                  COALESCE(sum(m.quantity) FILTER (WHERE m.movement_type = 'sale_return'), 0) AS q_back
             FROM stock_movements m
            WHERE m.tenant_id = o.tenant_id AND m.reference_type = 'order' AND m.reference_id = o.id) s
   WHERE o.status = 'cancelled' AND o.deleted_at IS NULL
     AND (p_tenant_id IS NULL OR o.tenant_id = p_tenant_id)
     AND o.cancelled_at < now() - p_grace
     AND o.cancelled_at >= now() - p_lookback
     AND ( s.q_sale <> s.q_back
           OR EXISTS (SELECT 1 FROM journal_entries je
                       WHERE je.tenant_id = o.tenant_id AND je.source_module = 'sales' AND je.source_entity_type = 'order'
                         AND je.source_entity_id = o.id AND je.reversal_of_id IS NULL AND je.status = 'posted') )
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- All checks in one call, and a per-check summary.
-- ---------------------------------------------------------------------------------------------------------------
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
$$;

CREATE OR REPLACE FUNCTION fn_fin_monitor_summary(
  p_tenant_id uuid DEFAULT NULL, p_grace interval DEFAULT '5 minutes', p_lookback interval DEFAULT '90 days')
RETURNS TABLE (check_id text, severity text, findings bigint, tenants bigint)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT a.check_id, a.severity, count(*), count(DISTINCT a.tenant_id)
    FROM fn_fin_monitor_all(p_tenant_id, p_grace, p_lookback) a
   GROUP BY a.check_id, a.severity
   ORDER BY a.check_id, a.severity
$$;

-- Supabase default privileges grant new objects to anon/authenticated: lock everything down; service_role only.
DO $grants$
DECLARE r regprocedure;
BEGIN
  FOR r IN SELECT p.oid::regprocedure FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_fin\_monitor\_%'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r);
  END LOOP;
END
$grants$;
