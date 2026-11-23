-- ROLLBACK of 335: restores the exact 329 body of fn_fin_monitor_all and drops everything 335 created.
-- REFUSES while OPEN financial exceptions exist (an unresolved record must never be destroyed silently): resolve them first
-- (fn_financial_exception_retry_batch) or export them. Resolved rows are history and are dropped with the table.
DO $chk$
BEGIN
  IF to_regclass('public.financial_exceptions') IS NOT NULL AND EXISTS (SELECT 1 FROM financial_exceptions WHERE status = 'open') THEN
    RAISE EXCEPTION '335 rollback refused: open financial_exceptions exist';
  END IF;
END
$chk$;

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

DROP FUNCTION IF EXISTS fn_fin_monitor_m10_open_exceptions(uuid, interval, interval);
DROP FUNCTION IF EXISTS fn_financial_exception_on_order_cancel(uuid, uuid, uuid, date);
DROP FUNCTION IF EXISTS fn_financial_exception_retry_batch(integer, uuid, uuid);
DROP FUNCTION IF EXISTS fn_financial_exception_retry(uuid, uuid);
DROP FUNCTION IF EXISTS fn_record_financial_exception(uuid, text, text, uuid, uuid, uuid, uuid, numeric, uuid, text);
DROP FUNCTION IF EXISTS fn_process_sale_stock_deduction_line(uuid, uuid, uuid, uuid, uuid, uuid, numeric);
DROP TABLE IF EXISTS financial_exceptions;
-- the catalog row goes too, unless posted catch-up entries (ledger history) still reference it
DELETE FROM financial_event_source_types t
 WHERE t.source_module = 'sales' AND t.source_entity_type = 'order_cogs_catchup'
   AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.source_module = t.source_module AND je.source_entity_type = t.source_entity_type);
