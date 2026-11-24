-- ROLLBACK ORDER (strict reverse of the apply order; never skip or reorder): 335, 333, 332, 330, 328, 327, 326, 325.
-- (329 and 331 are read-only / scratch-only and independent; roll 329 back only after 335.) Rolling back an earlier step while a later one is applied is NOT supported.
-- ROLLBACK of 329: drops exactly the read-only monitor functions that 329 created. Nothing else was touched by 329.
DROP FUNCTION IF EXISTS fn_fin_monitor_summary(uuid, interval, interval);
DROP FUNCTION IF EXISTS fn_fin_monitor_all(uuid, interval, interval);
DROP FUNCTION IF EXISTS fn_fin_monitor_m9_cancel_asymmetry(uuid, interval, interval);
DROP FUNCTION IF EXISTS fn_fin_monitor_m8_duplicate_or_unnumbered(uuid, interval, interval, interval);
DROP FUNCTION IF EXISTS fn_fin_monitor_m7_fiscal_coverage(uuid, integer);
DROP FUNCTION IF EXISTS fn_fin_monitor_m6_inventory_vs_ledger(uuid);
DROP FUNCTION IF EXISTS fn_fin_monitor_m5_stock_level_drift(uuid);
DROP FUNCTION IF EXISTS fn_fin_monitor_m4_movements_without_journal(uuid, interval, interval);
DROP FUNCTION IF EXISTS fn_fin_monitor_m3_orders_missing_movements(uuid, interval, interval);
DROP FUNCTION IF EXISTS fn_fin_monitor_m2_cogs_reconciliation(uuid, interval, interval);
DROP FUNCTION IF EXISTS fn_fin_monitor_m1_orders_without_entry(uuid, interval, interval);
