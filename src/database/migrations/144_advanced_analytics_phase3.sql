-- Migration 7.3 — Advanced Analytics Phase 3 (final #18 items).
--
-- Two new read-only reporting RPCs (Stock Accuracy, Inventory Coverage),
-- extending the existing Advanced Analytics surface (Phases 1/2, migrations
-- 142/143). Both STABLE, SELECT-only. Stock Accuracy reads only completed
-- stock_counts/stock_count_items — no changes to fn_finalize_stock_count or
-- fn_approve_stock_count. Coverage reuses the existing
-- fn_calculate_demand_forecast (migration 113) rather than reimplementing
-- demand calculation, per explicit instruction.

-- 1. Stock Accuracy — variance-based accuracy % from completed stock counts.
CREATE OR REPLACE FUNCTION fn_inventory_stock_accuracy_report(
  p_tenant_id    UUID,
  p_date_from    DATE,
  p_date_to      DATE,
  p_warehouse_id UUID DEFAULT NULL
)
RETURNS TABLE (
  warehouse_id                     UUID,
  total_items_counted              BIGINT,
  zero_variance_items              BIGINT,
  total_expected_quantity          NUMERIC,
  total_absolute_variance_quantity NUMERIC,
  accuracy_percentage              NUMERIC
) AS $$
  SELECT
    sc.warehouse_id,
    COUNT(sci.id) AS total_items_counted,
    COUNT(sci.id) FILTER (WHERE COALESCE(sci.variance, 0) = 0) AS zero_variance_items,
    SUM(sci.expected_quantity) AS total_expected_quantity,
    SUM(ABS(COALESCE(sci.variance, 0))) AS total_absolute_variance_quantity,
    CASE WHEN SUM(sci.expected_quantity) > 0
      THEN ROUND(
        ((SUM(sci.expected_quantity) - SUM(ABS(COALESCE(sci.variance, 0)))) / SUM(sci.expected_quantity)) * 100,
        2
      )
      ELSE NULL
    END AS accuracy_percentage
  FROM stock_counts sc
  JOIN stock_count_items sci ON sci.stock_count_id = sc.id
  WHERE sc.tenant_id = p_tenant_id
    AND sc.status = 'completed'
    AND sc.completed_at::date BETWEEN p_date_from AND p_date_to
    AND (p_warehouse_id IS NULL OR sc.warehouse_id = p_warehouse_id)
  GROUP BY sc.warehouse_id;
$$ LANGUAGE sql STABLE;

-- 2. Inventory Coverage — days of stock remaining at current demand velocity.
-- Reuses fn_calculate_demand_forecast (113) via LATERAL (computed once per
-- row) rather than reimplementing demand calculation.
CREATE OR REPLACE FUNCTION fn_inventory_coverage_report(
  p_tenant_id    UUID,
  p_warehouse_id UUID DEFAULT NULL
)
RETURNS TABLE (
  warehouse_id         UUID,
  item_id              UUID,
  item_name            TEXT,
  quantity_on_hand     NUMERIC,
  average_daily_demand NUMERIC,
  days_of_coverage     NUMERIC
) AS $$
  SELECT
    sl.warehouse_id,
    sl.item_id,
    i.name AS item_name,
    sl.quantity_on_hand,
    d.avg_demand AS average_daily_demand,
    CASE WHEN d.avg_demand > 0
      THEN ROUND(sl.quantity_on_hand / d.avg_demand, 2)
      ELSE NULL
    END AS days_of_coverage
  FROM stock_levels sl
  JOIN items i ON i.id = sl.item_id
  CROSS JOIN LATERAL (
    SELECT fn_calculate_demand_forecast(p_tenant_id, sl.warehouse_id, sl.item_id, sl.variant_id, 30) AS avg_demand
  ) d
  WHERE sl.tenant_id = p_tenant_id
    AND sl.quantity_on_hand > 0
    AND (p_warehouse_id IS NULL OR sl.warehouse_id = p_warehouse_id);
$$ LANGUAGE sql STABLE;
