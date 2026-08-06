-- Migration 11.1b — Inventory Snapshots (#21 Enterprise Controls).
--
-- A pure historical reporting layer over stock_levels/cost_layers — NOT a
-- replacement ledger. fn_generate_inventory_snapshot only ever SELECTs from
-- stock_levels/cost_layers and INSERTs into the two new tables below; it
-- never writes to stock_levels, stock_movements, or cost_layers, and never
-- touches fn_apply_stock_movement or the costing engine.

CREATE TABLE inventory_snapshot_runs (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  snapshot_date DATE        NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded')),
  generated_by  UUID        REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Duplicate protection: only one ACTIVE run per (tenant, date) — superseded
-- runs are explicitly excluded, so history for the same date can accumulate
-- (draft -> superseded -> superseded -> ... -> active) without ever
-- violating this constraint, exactly the "active snapshot per date +
-- superseding + old snapshots remain" behavior required.
CREATE UNIQUE INDEX uq_snapshot_runs_active_date
  ON inventory_snapshot_runs(tenant_id, snapshot_date)
  WHERE status = 'active';
CREATE INDEX idx_snapshot_runs_tenant_date ON inventory_snapshot_runs(tenant_id, snapshot_date);
ALTER TABLE inventory_snapshot_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON inventory_snapshot_runs
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.inventory_snapshot_runs TO service_role;

CREATE TABLE inventory_snapshot_items (
  id                 UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  snapshot_run_id    UUID          NOT NULL REFERENCES inventory_snapshot_runs(id) ON DELETE CASCADE,
  warehouse_id       UUID          NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  item_id            UUID          NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  variant_id         UUID          REFERENCES item_variants(id) ON DELETE RESTRICT,
  quantity_on_hand   NUMERIC(14,4) NOT NULL,
  average_unit_cost  NUMERIC(14,4) NOT NULL,
  inventory_value    NUMERIC(16,4) NOT NULL,
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_snapshot_items_run ON inventory_snapshot_items(tenant_id, snapshot_run_id);
CREATE INDEX idx_snapshot_items_item ON inventory_snapshot_items(tenant_id, warehouse_id, item_id);
ALTER TABLE inventory_snapshot_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON inventory_snapshot_items
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.inventory_snapshot_items TO service_role;

-- Generates a snapshot run + item rows from CURRENT stock_levels/cost_layers.
-- VOLATILE (not STABLE) — this function performs INSERTs, unlike every
-- Advanced Analytics report RPC, which are pure SELECT-only STABLE
-- functions. Reuses the exact valuation formula already proven in
-- fn_inventory_valuation_report (142) — no new costing method invented.
-- p_supersede: when true and an active run already exists for this date,
-- that run is flipped to 'superseded' (never deleted, never mutated at the
-- item level) before the new run is created. When false (default) and an
-- active run already exists for this date, the function raises rather than
-- silently overwriting — duplicate protection at the RPC layer, matching
-- the unique index above.
CREATE OR REPLACE FUNCTION fn_generate_inventory_snapshot(
  p_tenant_id     UUID,
  p_actor_id      UUID,
  p_snapshot_date DATE DEFAULT CURRENT_DATE,
  p_supersede     BOOLEAN DEFAULT false
) RETURNS inventory_snapshot_runs AS $$
DECLARE
  v_existing_id UUID;
  v_run         inventory_snapshot_runs;
BEGIN
  SELECT id INTO v_existing_id
    FROM inventory_snapshot_runs
   WHERE tenant_id = p_tenant_id
     AND snapshot_date = p_snapshot_date
     AND status = 'active'
   FOR UPDATE;

  IF v_existing_id IS NOT NULL THEN
    IF NOT p_supersede THEN
      RAISE EXCEPTION 'An active snapshot already exists for % — pass supersede=true to replace it', p_snapshot_date;
    END IF;
    UPDATE inventory_snapshot_runs SET status = 'superseded' WHERE id = v_existing_id;
  END IF;

  INSERT INTO inventory_snapshot_runs (tenant_id, snapshot_date, status, generated_by)
  VALUES (p_tenant_id, p_snapshot_date, 'active', p_actor_id)
  RETURNING * INTO v_run;

  -- Same formula as fn_inventory_valuation_report (142): SUM(quantity_remaining)
  -- and weighted SUM(quantity_remaining * unit_cost) / SUM(quantity_remaining)
  -- from cost_layers, grouped per warehouse/item/variant. Read-only against
  -- cost_layers/stock_levels — no writes to either table anywhere here.
  INSERT INTO inventory_snapshot_items (
    tenant_id, snapshot_run_id, warehouse_id, item_id, variant_id,
    quantity_on_hand, average_unit_cost, inventory_value
  )
  SELECT
    p_tenant_id,
    v_run.id,
    cl.warehouse_id,
    cl.item_id,
    cl.variant_id,
    SUM(cl.quantity_remaining) AS quantity_on_hand,
    CASE WHEN SUM(cl.quantity_remaining) > 0
      THEN SUM(cl.quantity_remaining * cl.unit_cost) / SUM(cl.quantity_remaining)
      ELSE 0
    END AS average_unit_cost,
    SUM(cl.quantity_remaining * cl.unit_cost) AS inventory_value
  FROM cost_layers cl
  WHERE cl.tenant_id = p_tenant_id
    AND cl.quantity_remaining > 0
  GROUP BY cl.warehouse_id, cl.item_id, cl.variant_id;

  RETURN v_run;
END;
$$ LANGUAGE plpgsql VOLATILE;
