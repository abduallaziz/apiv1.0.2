-- Inventory redesign — Part A item #16: Manufacturing (BOM + production
-- orders). Confirmed zero manufacturing concept existed anywhere before
-- this migration.
--
-- Reuses movement types already added in Phase 1 (migration 095) but
-- never actually used until now: 'production_consumption'/
-- 'production_receipt'. Consumption/receipt both go through the EXISTING,
-- already-tested primitives (fn_apply_stock_movement, fn_consume_cost_layers,
-- fn_add_cost_layer) — no new stock-movement mechanics invented, just a
-- new caller.
--
-- Multi-level BOM needs no special schema: a semi-finished item's own
-- production order is posted first (its output becomes real on-hand
-- stock via fn_add_cost_layer), then consumed as an ordinary component by
-- a higher-level production order — standard sub-assembly pattern, not a
-- recursive "explode everything in one call" engine.

CREATE TABLE work_centers (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  warehouse_id UUID        REFERENCES warehouses(id) ON DELETE SET NULL,
  name         TEXT        NOT NULL,
  is_active    BOOLEAN     NOT NULL DEFAULT true,
  deleted_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE work_centers ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON work_centers
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.work_centers TO service_role;

CREATE TABLE bill_of_materials (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item_id       UUID        NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  variant_id    UUID        REFERENCES item_variants(id) ON DELETE CASCADE,
  version       INTEGER     NOT NULL DEFAULT 1,
  is_active     BOOLEAN     NOT NULL DEFAULT true,
  notes         TEXT,
  deleted_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_bom_item ON bill_of_materials(tenant_id, item_id) WHERE deleted_at IS NULL;
-- Only one active BOM per item/variant at a time — a production order
-- always resolves to an unambiguous recipe.
CREATE UNIQUE INDEX uq_bom_active_per_item ON bill_of_materials(
  tenant_id, item_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
) WHERE is_active = true AND deleted_at IS NULL;
ALTER TABLE bill_of_materials ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON bill_of_materials
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.bill_of_materials TO service_role;

CREATE TABLE bom_lines (
  id                  UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  bom_id              UUID          NOT NULL REFERENCES bill_of_materials(id) ON DELETE CASCADE,
  component_item_id   UUID          NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  component_variant_id UUID         REFERENCES item_variants(id) ON DELETE RESTRICT,
  quantity_per_unit   NUMERIC(14,4) NOT NULL CHECK (quantity_per_unit > 0),
  scrap_percentage    NUMERIC(5,2)  NOT NULL DEFAULT 0 CHECK (scrap_percentage >= 0 AND scrap_percentage < 100),
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_bom_lines_bom ON bom_lines(bom_id);
ALTER TABLE bom_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON bom_lines
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.bom_lines TO service_role;

CREATE TABLE production_orders (
  id                UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  warehouse_id      UUID          NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  bom_id            UUID          NOT NULL REFERENCES bill_of_materials(id) ON DELETE RESTRICT,
  work_center_id    UUID          REFERENCES work_centers(id) ON DELETE SET NULL,
  order_number      TEXT          NOT NULL,
  quantity_planned  NUMERIC(14,4) NOT NULL CHECK (quantity_planned > 0),
  quantity_produced NUMERIC(14,4),
  status            TEXT          NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in_progress', 'completed', 'cancelled')),
  scheduled_date    DATE,
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  created_by        UUID          REFERENCES users(id),
  notes             TEXT,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX uq_po_manuf_tenant_number ON production_orders(tenant_id, order_number);
CREATE INDEX idx_production_orders_status ON production_orders(tenant_id, status);
ALTER TABLE production_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON production_orders
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.production_orders TO service_role;

-- Posts a production order: consumes every BOM component (scaled by
-- quantity_produced, scrap_percentage applied), then receives the
-- produced item into stock with unit_cost = real rolled-up component
-- cost / quantity_produced (not a guess — the actual weighted cost of
-- what was actually consumed). Component shortfall raises
-- INSUFFICIENT_COST_LAYERS/INSUFFICIENT_STOCK exactly like any other
-- consumption — production does NOT opt into backorder (unlike sales),
-- since you can't produce with material that doesn't exist yet.
CREATE OR REPLACE FUNCTION fn_post_production_order(
  p_production_order_id UUID,
  p_actor_id             UUID,
  p_quantity_produced    NUMERIC DEFAULT NULL
) RETURNS production_orders AS $$
DECLARE
  v_order  production_orders;
  v_bom    bill_of_materials;
  v_line   RECORD;
  v_qty_needed NUMERIC;
  v_unit_cost  NUMERIC;
  v_total_component_cost NUMERIC := 0;
  v_output_unit_cost NUMERIC;
  v_movement stock_movements;
  v_actual_qty NUMERIC;
BEGIN
  SELECT * INTO v_order FROM production_orders WHERE id = p_production_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'production order % not found', p_production_order_id;
  END IF;
  IF v_order.status <> 'draft' THEN
    RAISE EXCEPTION 'production order % is not draft (status=%)', p_production_order_id, v_order.status;
  END IF;

  SELECT * INTO v_bom FROM bill_of_materials WHERE id = v_order.bom_id;
  v_actual_qty := COALESCE(p_quantity_produced, v_order.quantity_planned);

  FOR v_line IN SELECT * FROM bom_lines WHERE bom_id = v_order.bom_id LOOP
    v_qty_needed := v_line.quantity_per_unit * v_actual_qty * (1 + v_line.scrap_percentage / 100);

    v_unit_cost := fn_consume_cost_layers(
      v_order.tenant_id, v_order.warehouse_id, v_line.component_item_id, v_line.component_variant_id,
      v_qty_needed
    );

    v_movement := fn_apply_stock_movement(
      v_order.tenant_id, v_order.warehouse_id, NULL, v_line.component_item_id, v_line.component_variant_id, NULL,
      'production_consumption', 'out', v_qty_needed, v_unit_cost,
      'production_order', p_production_order_id, p_actor_id
    );

    v_total_component_cost := v_total_component_cost + (v_qty_needed * v_unit_cost);
  END LOOP;

  v_output_unit_cost := ROUND(v_total_component_cost / v_actual_qty, 4);

  v_movement := fn_apply_stock_movement(
    v_order.tenant_id, v_order.warehouse_id, NULL, v_bom.item_id, v_bom.variant_id, NULL,
    'production_receipt', 'in', v_actual_qty, v_output_unit_cost,
    'production_order', p_production_order_id, p_actor_id
  );

  PERFORM fn_add_cost_layer(
    v_order.tenant_id, v_order.warehouse_id, v_bom.item_id, v_bom.variant_id, NULL,
    v_actual_qty, v_output_unit_cost, v_movement.id
  );

  UPDATE production_orders
     SET status = 'completed',
         quantity_produced = v_actual_qty,
         started_at = COALESCE(started_at, NOW()),
         completed_at = NOW(),
         updated_at = NOW()
   WHERE id = p_production_order_id
   RETURNING * INTO v_order;

  PERFORM _emit_domain_event(
    v_order.tenant_id, 'inventory.production_order.completed', 'production_order', v_order.id,
    jsonb_build_object('bom_id', v_order.bom_id, 'quantity_produced', v_actual_qty, 'unit_cost', v_output_unit_cost)
  );

  RETURN v_order;
END;
$$ LANGUAGE plpgsql;
