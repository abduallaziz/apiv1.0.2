-- Migration 12.1 — Supplier-Item Lead Time & MOQ (#22, justified subset only).
--
-- supplier_items is standing purchasing master data — a supplier's
-- configured lead time / minimum order quantity for a specific item (or
-- item+variant), independent of any RFQ/quote. Extends the existing
-- Purchasing/Planning fallback chain additively; fn_apply_stock_movement,
-- the costing engine, cost_layers, and stock_levels/stock_movements are
-- untouched. fn_purchase_suggestions keeps its exact 1-param signature —
-- only its lead-time fallback chain and suggested-quantity floor gain one
-- new, additive tier each.

CREATE TABLE supplier_items (
  id                     UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id              UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  supplier_id            UUID          NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  item_id                UUID          NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  variant_id             UUID          REFERENCES item_variants(id) ON DELETE CASCADE,
  lead_time_days         NUMERIC(6,2)  CHECK (lead_time_days IS NULL OR lead_time_days >= 0),
  minimum_order_quantity NUMERIC(14,4) CHECK (minimum_order_quantity IS NULL OR minimum_order_quantity > 0),
  is_preferred           BOOLEAN       NOT NULL DEFAULT false,
  created_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
-- One configuration row per (supplier, item, variant) — variant_id NULL is
-- its own distinct "item-level, no specific variant" bucket, same COALESCE
-- convention used by stock_levels/cost_layers/every other table this
-- session with an optional variant dimension.
CREATE UNIQUE INDEX uq_supplier_items_scope ON supplier_items(
  tenant_id, supplier_id, item_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
);
CREATE INDEX idx_supplier_items_tenant ON supplier_items(tenant_id);
CREATE INDEX idx_supplier_items_supplier ON supplier_items(tenant_id, supplier_id);
CREATE INDEX idx_supplier_items_item ON supplier_items(tenant_id, item_id);
CREATE INDEX idx_supplier_items_variant ON supplier_items(tenant_id, variant_id) WHERE variant_id IS NOT NULL;
ALTER TABLE supplier_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON supplier_items
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.supplier_items TO service_role;

-- Resolves the single supplier_items row to use for a given (item, variant)
-- — a variant-specific row always wins over an item-level (variant_id IS
-- NULL) row for the same item; among ties, the preferred supplier wins,
-- then most recently updated. Returns NULL (no row) if none configured —
-- callers must treat that as "fall through to the next tier," never as an
-- error.
CREATE OR REPLACE FUNCTION fn_resolve_supplier_item(
  p_tenant_id  UUID,
  p_item_id    UUID,
  p_variant_id UUID
) RETURNS supplier_items AS $$
  SELECT si.*
  FROM supplier_items si
  WHERE si.tenant_id = p_tenant_id
    AND si.item_id = p_item_id
    AND (
      (p_variant_id IS NOT NULL AND si.variant_id = p_variant_id)
      OR si.variant_id IS NULL
    )
  ORDER BY (si.variant_id IS NOT NULL) DESC, si.is_preferred DESC, si.updated_at DESC
  LIMIT 1;
$$ LANGUAGE sql STABLE;

-- fn_purchase_suggestions: same 1-param signature. Lead-time fallback chain
-- gains supplier_items.lead_time_days as the FIRST tier (per approved
-- priority: supplier_items -> reorder_points -> historical average ->
-- 7-day fallback). One new output column, minimum_order_quantity, exposes
-- the resolved MOQ (NULL when unconfigured) and is folded into the existing
-- GREATEST() floor for suggested_order_quantity — no new algorithm, just
-- one more floor value alongside the pre-existing reorder_quantity floor.
-- Behavior is byte-for-byte unchanged for any (item, variant) with no
-- supplier_items row: fn_resolve_supplier_item returns NULL, every
-- COALESCE falls through exactly as it did before this migration.
-- Adding minimum_order_quantity changes the function's RETURNS TABLE row
-- type — Postgres requires dropping the old signature first (same lesson
-- as the postgres_function_overload_gotcha: CREATE OR REPLACE alone cannot
-- change OUT-parameter/return-row shape).
DROP FUNCTION IF EXISTS fn_purchase_suggestions(UUID);

CREATE FUNCTION fn_purchase_suggestions(p_tenant_id UUID)
RETURNS TABLE (
  reorder_point_id UUID,
  warehouse_id UUID,
  item_id UUID,
  variant_id UUID,
  item_name TEXT,
  quantity_available NUMERIC,
  quantity_incoming NUMERIC,
  avg_daily_demand NUMERIC,
  lead_time_days NUMERIC,
  forecasted_demand_during_lead_time NUMERIC,
  suggested_order_quantity NUMERIC,
  minimum_order_quantity NUMERIC
) AS $$
  SELECT
    rp.id,
    rp.warehouse_id,
    rp.item_id,
    rp.variant_id,
    i.name,
    COALESCE(vsb.quantity_available, 0),
    COALESCE(vsb.quantity_incoming, 0),
    fn_calculate_demand_forecast(rp.tenant_id, rp.warehouse_id, rp.item_id, rp.variant_id, 30),
    COALESCE(
      si.lead_time_days,
      rp.lead_time_days,
      fn_supplier_item_lead_time(rp.tenant_id, rp.item_id, NULL),
      7
    ),
    fn_calculate_demand_forecast(rp.tenant_id, rp.warehouse_id, rp.item_id, rp.variant_id, 30)
      * COALESCE(
          si.lead_time_days,
          rp.lead_time_days,
          fn_supplier_item_lead_time(rp.tenant_id, rp.item_id, NULL),
          7
        ),
    GREATEST(
      rp.reorder_quantity,
      (fn_calculate_demand_forecast(rp.tenant_id, rp.warehouse_id, rp.item_id, rp.variant_id, 30)
        * COALESCE(
            si.lead_time_days,
            rp.lead_time_days,
            fn_supplier_item_lead_time(rp.tenant_id, rp.item_id, NULL),
            7
          ))
        - COALESCE(vsb.quantity_available, 0) - COALESCE(vsb.quantity_incoming, 0),
      COALESCE(si.minimum_order_quantity, 0),
      0
    ),
    si.minimum_order_quantity
  FROM inventory_reorder_points rp
  JOIN items i ON i.id = rp.item_id
  LEFT JOIN v_stock_balance vsb
    ON vsb.tenant_id = rp.tenant_id AND vsb.warehouse_id = rp.warehouse_id AND vsb.item_id = rp.item_id
   AND COALESCE(vsb.variant_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(rp.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
  LEFT JOIN LATERAL (
    SELECT * FROM fn_resolve_supplier_item(rp.tenant_id, rp.item_id, rp.variant_id)
  ) si ON true
  WHERE rp.tenant_id = p_tenant_id AND rp.is_active = true
    AND (
      COALESCE(vsb.quantity_available, 0) <= rp.min_quantity
      OR COALESCE(vsb.quantity_available, 0) + COALESCE(vsb.quantity_incoming, 0)
         < (fn_calculate_demand_forecast(rp.tenant_id, rp.warehouse_id, rp.item_id, rp.variant_id, 30)
            * COALESCE(
                si.lead_time_days,
                rp.lead_time_days,
                fn_supplier_item_lead_time(rp.tenant_id, rp.item_id, NULL),
                7
              ))
    );
$$ LANGUAGE sql STABLE;
