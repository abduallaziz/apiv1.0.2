-- Migration 7.1 — Advanced Analytics Phase 1.
--
-- Three new read-only reporting RPCs (Inventory Valuation, Turnover, Aging).
-- All three are STABLE, SELECT-only, and read exclusively from the existing
-- cost_layers/stock_movements/items/warehouses tables — no schema changes,
-- no writes, no touching fn_apply_stock_movement or the costing engine.
--
-- Turnover's denominator uses CURRENT inventory valuation (cost_layers as of
-- now), per explicit Phase 1 decision — no inventory_snapshots/historical
-- valuation table, no period-close concept. A future phase may refine this
-- to a period-average value if a real need for it is confirmed.

-- 1. Inventory Valuation — current stock value from cost layers.
CREATE OR REPLACE FUNCTION fn_inventory_valuation_report(
  p_tenant_id    UUID,
  p_warehouse_id UUID DEFAULT NULL
)
RETURNS TABLE (
  warehouse_id      UUID,
  warehouse_name    TEXT,
  item_id           UUID,
  item_name         TEXT,
  variant_id        UUID,
  quantity_on_hand  NUMERIC,
  average_unit_cost NUMERIC,
  total_value       NUMERIC
) AS $$
  SELECT
    cl.warehouse_id,
    w.name AS warehouse_name,
    cl.item_id,
    i.name AS item_name,
    cl.variant_id,
    SUM(cl.quantity_remaining) AS quantity_on_hand,
    CASE WHEN SUM(cl.quantity_remaining) > 0
      THEN SUM(cl.quantity_remaining * cl.unit_cost) / SUM(cl.quantity_remaining)
      ELSE 0
    END AS average_unit_cost,
    SUM(cl.quantity_remaining * cl.unit_cost) AS total_value
  FROM cost_layers cl
  JOIN warehouses w ON w.id = cl.warehouse_id
  JOIN items i ON i.id = cl.item_id
  WHERE cl.tenant_id = p_tenant_id
    AND cl.quantity_remaining > 0
    AND (p_warehouse_id IS NULL OR cl.warehouse_id = p_warehouse_id)
  GROUP BY cl.warehouse_id, w.name, cl.item_id, i.name, cl.variant_id;
$$ LANGUAGE sql STABLE;

-- 2. Inventory Turnover — COGS in period / current inventory value.
-- Param order: p_warehouse_id moved after the required date params (Postgres
-- rejects a required param following one with a default — DEFAULT NULL
-- must be trailing, per 42P13).
CREATE OR REPLACE FUNCTION fn_inventory_turnover_report(
  p_tenant_id    UUID,
  p_date_from    DATE,
  p_date_to      DATE,
  p_warehouse_id UUID DEFAULT NULL
)
RETURNS TABLE (
  warehouse_id           UUID,
  item_id                UUID,
  cogs_in_period         NUMERIC,
  average_inventory_value NUMERIC,
  turnover_ratio         NUMERIC,
  days_in_period         INTEGER
) AS $$
  WITH cogs AS (
    SELECT sm.warehouse_id, sm.item_id, SUM(sm.total_cost) AS cogs_in_period
    FROM stock_movements sm
    WHERE sm.tenant_id = p_tenant_id
      AND sm.movement_type = 'sale'
      AND sm.direction = 'out'
      AND sm.occurred_at::date BETWEEN p_date_from AND p_date_to
      AND (p_warehouse_id IS NULL OR sm.warehouse_id = p_warehouse_id)
    GROUP BY sm.warehouse_id, sm.item_id
  ),
  valuation AS (
    SELECT cl.warehouse_id, cl.item_id, SUM(cl.quantity_remaining * cl.unit_cost) AS current_value
    FROM cost_layers cl
    WHERE cl.tenant_id = p_tenant_id
      AND cl.quantity_remaining > 0
      AND (p_warehouse_id IS NULL OR cl.warehouse_id = p_warehouse_id)
    GROUP BY cl.warehouse_id, cl.item_id
  )
  SELECT
    c.warehouse_id,
    c.item_id,
    c.cogs_in_period,
    COALESCE(v.current_value, 0) AS average_inventory_value,
    CASE WHEN COALESCE(v.current_value, 0) > 0
      THEN c.cogs_in_period / v.current_value
      ELSE NULL
    END AS turnover_ratio,
    (p_date_to - p_date_from + 1)::INTEGER AS days_in_period
  FROM cogs c
  LEFT JOIN valuation v ON v.warehouse_id = c.warehouse_id AND v.item_id = c.item_id;
$$ LANGUAGE sql STABLE;

-- 3. Inventory Aging — remaining cost-layer quantity bucketed by received_at age.
CREATE OR REPLACE FUNCTION fn_inventory_aging_report(
  p_tenant_id    UUID,
  p_warehouse_id UUID DEFAULT NULL
)
RETURNS TABLE (
  warehouse_id     UUID,
  item_id          UUID,
  bucket_0_30      NUMERIC,
  bucket_31_60     NUMERIC,
  bucket_61_90     NUMERIC,
  bucket_90_plus   NUMERIC,
  total_quantity   NUMERIC,
  total_value      NUMERIC
) AS $$
  SELECT
    cl.warehouse_id,
    cl.item_id,
    SUM(CASE WHEN NOW() - cl.received_at <= INTERVAL '30 days' THEN cl.quantity_remaining ELSE 0 END) AS bucket_0_30,
    SUM(CASE WHEN NOW() - cl.received_at > INTERVAL '30 days' AND NOW() - cl.received_at <= INTERVAL '60 days' THEN cl.quantity_remaining ELSE 0 END) AS bucket_31_60,
    SUM(CASE WHEN NOW() - cl.received_at > INTERVAL '60 days' AND NOW() - cl.received_at <= INTERVAL '90 days' THEN cl.quantity_remaining ELSE 0 END) AS bucket_61_90,
    SUM(CASE WHEN NOW() - cl.received_at > INTERVAL '90 days' THEN cl.quantity_remaining ELSE 0 END) AS bucket_90_plus,
    SUM(cl.quantity_remaining) AS total_quantity,
    SUM(cl.quantity_remaining * cl.unit_cost) AS total_value
  FROM cost_layers cl
  WHERE cl.tenant_id = p_tenant_id
    AND cl.quantity_remaining > 0
    AND (p_warehouse_id IS NULL OR cl.warehouse_id = p_warehouse_id)
  GROUP BY cl.warehouse_id, cl.item_id;
$$ LANGUAGE sql STABLE;
