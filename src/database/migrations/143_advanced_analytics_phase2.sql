-- Migration 7.2 — Advanced Analytics Phase 2.
--
-- Four new read-only reporting RPCs (ABC Analysis, Dead Stock, Slow Moving,
-- Overstock), extending the existing Advanced Analytics surface (Phase 1,
-- migration 142). All STABLE, SELECT-only, reading exclusively from
-- stock_levels/stock_movements/cost_layers/items/inventory_reorder_points —
-- no schema changes, no writes, no touching fn_apply_stock_movement or the
-- costing engine. Every DEFAULT-bearing parameter is declared after all
-- required ones (per the 42P13 lesson from migration 142).

-- 1. ABC Analysis — items ranked by COGS, classified by cumulative % (Pareto).
CREATE OR REPLACE FUNCTION fn_inventory_abc_analysis(
  p_tenant_id    UUID,
  p_date_from    DATE,
  p_date_to      DATE,
  p_warehouse_id UUID DEFAULT NULL
)
RETURNS TABLE (
  item_id               UUID,
  item_name             TEXT,
  warehouse_id          UUID,
  cogs_in_period        NUMERIC,
  cumulative_percentage NUMERIC,
  classification        TEXT
) AS $$
  WITH item_cogs AS (
    SELECT sm.item_id, sm.warehouse_id, i.name AS item_name, SUM(sm.total_cost) AS cogs_in_period
    FROM stock_movements sm
    JOIN items i ON i.id = sm.item_id
    WHERE sm.tenant_id = p_tenant_id
      AND sm.movement_type = 'sale'
      AND sm.direction = 'out'
      AND sm.occurred_at::date BETWEEN p_date_from AND p_date_to
      AND (p_warehouse_id IS NULL OR sm.warehouse_id = p_warehouse_id)
    GROUP BY sm.item_id, sm.warehouse_id, i.name
  ),
  totals AS (
    SELECT SUM(cogs_in_period) AS grand_total FROM item_cogs
  ),
  ranked AS (
    SELECT
      ic.item_id, ic.item_name, ic.warehouse_id, ic.cogs_in_period,
      SUM(ic.cogs_in_period) OVER (ORDER BY ic.cogs_in_period DESC ROWS UNBOUNDED PRECEDING) AS running_total,
      t.grand_total
    FROM item_cogs ic CROSS JOIN totals t
  )
  SELECT
    item_id, item_name, warehouse_id, cogs_in_period,
    ROUND((running_total / NULLIF(grand_total, 0)) * 100, 2) AS cumulative_percentage,
    CASE
      WHEN (running_total / NULLIF(grand_total, 0)) <= 0.80 THEN 'A'
      WHEN (running_total / NULLIF(grand_total, 0)) <= 0.95 THEN 'B'
      ELSE 'C'
    END AS classification
  FROM ranked
  ORDER BY cogs_in_period DESC;
$$ LANGUAGE sql STABLE;

-- 2. Dead Stock — on-hand quantity with zero outbound movement in the window.
CREATE OR REPLACE FUNCTION fn_inventory_dead_stock_report(
  p_tenant_id     UUID,
  p_lookback_days INTEGER DEFAULT 90,
  p_warehouse_id  UUID DEFAULT NULL
)
RETURNS TABLE (
  item_id          UUID,
  item_name        TEXT,
  warehouse_id     UUID,
  quantity_on_hand NUMERIC,
  total_value      NUMERIC,
  last_outbound_at TIMESTAMPTZ
) AS $$
  WITH last_out AS (
    SELECT item_id, warehouse_id, MAX(occurred_at) AS last_outbound_at
    FROM stock_movements
    WHERE tenant_id = p_tenant_id AND direction = 'out'
    GROUP BY item_id, warehouse_id
  ),
  valuation AS (
    SELECT item_id, warehouse_id, SUM(quantity_remaining * unit_cost) AS total_value
    FROM cost_layers
    WHERE tenant_id = p_tenant_id AND quantity_remaining > 0
    GROUP BY item_id, warehouse_id
  )
  SELECT
    sl.item_id, i.name AS item_name, sl.warehouse_id, sl.quantity_on_hand,
    COALESCE(v.total_value, 0) AS total_value,
    lo.last_outbound_at
  FROM stock_levels sl
  JOIN items i ON i.id = sl.item_id
  LEFT JOIN last_out lo ON lo.item_id = sl.item_id AND lo.warehouse_id = sl.warehouse_id
  LEFT JOIN valuation v ON v.item_id = sl.item_id AND v.warehouse_id = sl.warehouse_id
  WHERE sl.tenant_id = p_tenant_id
    AND sl.quantity_on_hand > 0
    AND (p_warehouse_id IS NULL OR sl.warehouse_id = p_warehouse_id)
    AND (lo.last_outbound_at IS NULL OR lo.last_outbound_at < NOW() - make_interval(days => p_lookback_days));
$$ LANGUAGE sql STABLE;

-- 3. Slow Moving — on-hand quantity with SOME but low outbound movement.
-- Deliberately independent of fn_inventory_turnover_report (Phase 1) — its
-- own turnover_ratio field is computed locally, never calls that RPC.
CREATE OR REPLACE FUNCTION fn_inventory_slow_moving_report(
  p_tenant_id       UUID,
  p_lookback_days   INTEGER DEFAULT 90,
  p_max_units_sold  NUMERIC DEFAULT 5,
  p_warehouse_id    UUID DEFAULT NULL
)
RETURNS TABLE (
  item_id             UUID,
  item_name           TEXT,
  warehouse_id        UUID,
  quantity_on_hand    NUMERIC,
  units_sold_in_window NUMERIC,
  turnover_ratio      NUMERIC
) AS $$
  WITH sold AS (
    SELECT item_id, warehouse_id, SUM(quantity) AS units_sold_in_window, SUM(total_cost) AS cogs_in_window
    FROM stock_movements
    WHERE tenant_id = p_tenant_id
      AND movement_type = 'sale'
      AND direction = 'out'
      AND occurred_at >= NOW() - make_interval(days => p_lookback_days)
      AND (p_warehouse_id IS NULL OR warehouse_id = p_warehouse_id)
    GROUP BY item_id, warehouse_id
  ),
  valuation AS (
    SELECT item_id, warehouse_id, SUM(quantity_remaining * unit_cost) AS current_value
    FROM cost_layers
    WHERE tenant_id = p_tenant_id AND quantity_remaining > 0
    GROUP BY item_id, warehouse_id
  )
  SELECT
    sl.item_id, i.name AS item_name, sl.warehouse_id, sl.quantity_on_hand,
    COALESCE(s.units_sold_in_window, 0) AS units_sold_in_window,
    CASE WHEN COALESCE(v.current_value, 0) > 0
      THEN COALESCE(s.cogs_in_window, 0) / v.current_value
      ELSE NULL
    END AS turnover_ratio
  FROM stock_levels sl
  JOIN items i ON i.id = sl.item_id
  LEFT JOIN sold s ON s.item_id = sl.item_id AND s.warehouse_id = sl.warehouse_id
  LEFT JOIN valuation v ON v.item_id = sl.item_id AND v.warehouse_id = sl.warehouse_id
  WHERE sl.tenant_id = p_tenant_id
    AND sl.quantity_on_hand > 0
    AND (p_warehouse_id IS NULL OR sl.warehouse_id = p_warehouse_id)
    AND COALESCE(s.units_sold_in_window, 0) > 0
    AND COALESCE(s.units_sold_in_window, 0) <= p_max_units_sold;
$$ LANGUAGE sql STABLE;

-- 4. Overstock — on-hand quantity exceeding inventory_reorder_points.max_quantity.
CREATE OR REPLACE FUNCTION fn_inventory_overstock_report(
  p_tenant_id    UUID,
  p_warehouse_id UUID DEFAULT NULL
)
RETURNS TABLE (
  item_id           UUID,
  item_name         TEXT,
  warehouse_id      UUID,
  quantity_on_hand  NUMERIC,
  max_quantity      NUMERIC,
  excess_quantity   NUMERIC,
  excess_value      NUMERIC,
  has_reorder_point BOOLEAN
) AS $$
  WITH valuation AS (
    SELECT item_id, warehouse_id,
      CASE WHEN SUM(quantity_remaining) > 0
        THEN SUM(quantity_remaining * unit_cost) / SUM(quantity_remaining)
        ELSE 0
      END AS avg_unit_cost
    FROM cost_layers
    WHERE tenant_id = p_tenant_id AND quantity_remaining > 0
    GROUP BY item_id, warehouse_id
  )
  SELECT
    sl.item_id, i.name AS item_name, sl.warehouse_id, sl.quantity_on_hand,
    rp.max_quantity,
    CASE WHEN rp.id IS NOT NULL AND rp.is_active AND rp.max_quantity IS NOT NULL
      THEN GREATEST(sl.quantity_on_hand - rp.max_quantity, 0)
      ELSE NULL
    END AS excess_quantity,
    CASE WHEN rp.id IS NOT NULL AND rp.is_active AND rp.max_quantity IS NOT NULL
      THEN GREATEST(sl.quantity_on_hand - rp.max_quantity, 0) * COALESCE(v.avg_unit_cost, 0)
      ELSE NULL
    END AS excess_value,
    (rp.id IS NOT NULL AND rp.is_active AND rp.max_quantity IS NOT NULL) AS has_reorder_point
  FROM stock_levels sl
  JOIN items i ON i.id = sl.item_id
  LEFT JOIN inventory_reorder_points rp
    ON rp.tenant_id = sl.tenant_id
    AND rp.warehouse_id = sl.warehouse_id
    AND rp.item_id = sl.item_id
    AND COALESCE(rp.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = COALESCE(sl.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
  LEFT JOIN valuation v ON v.item_id = sl.item_id AND v.warehouse_id = sl.warehouse_id
  WHERE sl.tenant_id = p_tenant_id
    AND sl.quantity_on_hand > 0
    AND (p_warehouse_id IS NULL OR sl.warehouse_id = p_warehouse_id);
$$ LANGUAGE sql STABLE;
