-- Migration 13.16C — Roadmap #16 (Manufacturing) completion: Subcontracting,
-- the eighth and final named sub-scope. Additive only —
-- bill_of_materials, production_orders' existing columns,
-- fn_post_production_order, stock_movements' existing meanings,
-- cost_layers, every costing method, transfers, and ownership tables are
-- all untouched (byte-for-byte, not redefined by this migration).
--
-- Architecture note (from the 13.16C audit): subcontracting needs a real
-- new concept — inventory that has physically left the tenant's own
-- warehouses but is still their asset, being processed externally. This
-- is deliberately NOT modeled via stock_ownership_layers (that table
-- requires a real internal warehouse_id — it tracks WHO owns stock
-- sitting in your warehouse, not stock that has left it) and NOT via
-- stock_transfers (hard NOT NULL FK to warehouses on both ends). Instead:
-- materials leaving are a real 'out' stock movement (they truly leave
-- on-hand availability, consistent with "decrease internal available
-- stock" in the approved scope) with cost drawn via the EXISTING
-- fn_consume_cost_layers, and "preserve ownership information" is
-- satisfied by subcontract_order_lines itself being the durable record
-- of what was sent, to which supplier, and what's expected back — a
-- purpose-built ledger for this specific relationship, not a repurposing
-- of the ownership overlay (which models a different concept: shared
-- physical custody, not off-site processing).

-- =============================================================================
-- PHASE 2 — Subcontractor identification
-- =============================================================================
ALTER TABLE suppliers ADD COLUMN is_subcontractor BOOLEAN NOT NULL DEFAULT false;

-- =============================================================================
-- PHASE 4 — additive stock_movements types (same pattern as 095/155)
-- =============================================================================
ALTER TABLE stock_movements
  DROP CONSTRAINT stock_movements_movement_type_check;
ALTER TABLE stock_movements
  ADD CONSTRAINT stock_movements_movement_type_check
  CHECK (movement_type IN (
    'receipt','sale','sale_return','adjustment_in','adjustment_out',
    'transfer_out','transfer_in','count_correction_in','count_correction_out',
    'purchase_return','damage','expiry','production_consumption','production_receipt',
    'production_scrap','subcontract_out','subcontract_in'
  ));

-- =============================================================================
-- PHASE 3 — subcontract_orders / subcontract_order_lines
-- =============================================================================
CREATE TABLE subcontract_orders (
  id                  UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  production_order_id UUID          REFERENCES production_orders(id) ON DELETE SET NULL,
  supplier_id         UUID          NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  -- Not in the approved field list, but required: fn_apply_stock_movement/
  -- fn_consume_cost_layers/fn_add_cost_layer all need a warehouse to
  -- operate against, same as every other order-like table in this schema
  -- (production_orders, goods_receipts) already carries one.
  warehouse_id        UUID          NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  order_number        TEXT          NOT NULL,
  status              TEXT          NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'processing', 'received', 'cancelled')),
  sent_at             TIMESTAMPTZ,
  received_at         TIMESTAMPTZ,
  created_by          UUID          REFERENCES users(id),
  notes               TEXT,
  deleted_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX uq_subcontract_orders_tenant_number ON subcontract_orders(tenant_id, order_number);
CREATE INDEX idx_subcontract_orders_status ON subcontract_orders(tenant_id, status);
CREATE INDEX idx_subcontract_orders_production_order ON subcontract_orders(production_order_id) WHERE production_order_id IS NOT NULL;
ALTER TABLE subcontract_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON subcontract_orders
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.subcontract_orders TO service_role;

CREATE TABLE subcontract_order_lines (
  id                    UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subcontract_order_id  UUID          NOT NULL REFERENCES subcontract_orders(id) ON DELETE CASCADE,
  material_item_id      UUID          NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  material_variant_id   UUID          REFERENCES item_variants(id) ON DELETE RESTRICT,
  quantity_sent         NUMERIC(14,4) NOT NULL CHECK (quantity_sent > 0),
  quantity_returned     NUMERIC(14,4) CHECK (quantity_returned IS NULL OR quantity_returned >= 0),
  -- Populated by fn_send_subcontract_materials/fn_receive_subcontract_output
  -- from what fn_consume_cost_layers/the cost allocation actually computed —
  -- never client-supplied, purely a record of what happened.
  material_unit_cost    NUMERIC(14,4),
  output_item_id        UUID          NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  output_variant_id     UUID          REFERENCES item_variants(id) ON DELETE RESTRICT,
  output_quantity       NUMERIC(14,4) NOT NULL CHECK (output_quantity > 0),
  output_unit_cost      NUMERIC(14,4),
  sent_movement_id      UUID          REFERENCES stock_movements(id),
  received_movement_id  UUID          REFERENCES stock_movements(id),
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_subcontract_lines_order ON subcontract_order_lines(tenant_id, subcontract_order_id);
ALTER TABLE subcontract_order_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON subcontract_order_lines
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.subcontract_order_lines TO service_role;

-- =============================================================================
-- PHASE 5 — subcontract_costs (service fees, mirrors landed_costs' shape)
-- =============================================================================
CREATE TABLE subcontract_costs (
  id                    UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subcontract_order_id  UUID          NOT NULL REFERENCES subcontract_orders(id) ON DELETE CASCADE,
  cost_type             TEXT          NOT NULL CHECK (cost_type IN ('service_fee', 'shipping', 'other')),
  amount                NUMERIC(14,4) NOT NULL CHECK (amount >= 0),
  notes                 TEXT,
  created_by            UUID          REFERENCES users(id),
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_subcontract_costs_order ON subcontract_costs(subcontract_order_id);
ALTER TABLE subcontract_costs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON subcontract_costs
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.subcontract_costs TO service_role;

-- =============================================================================
-- Sends every line's material to the subcontractor: consumes real cost
-- layers (fn_consume_cost_layers, unmodified) and posts a real 'out'
-- movement (fn_apply_stock_movement, unmodified) with the NEW additive
-- 'subcontract_out' type — decreasing on-hand exactly like any other
-- outbound movement (stock cannot go negative: the existing
-- INSUFFICIENT_STOCK guard inside fn_apply_stock_movement/
-- fn_consume_cost_layers applies unchanged, since neither function is
-- modified here). draft -> sent only.
-- =============================================================================
CREATE OR REPLACE FUNCTION fn_send_subcontract_materials(
  p_tenant_id            UUID,
  p_subcontract_order_id UUID,
  p_actor_id             UUID
) RETURNS subcontract_orders AS $$
DECLARE
  v_order subcontract_orders;
  v_line  RECORD;
  v_unit_cost NUMERIC;
  v_movement stock_movements;
BEGIN
  SELECT * INTO v_order FROM subcontract_orders
   WHERE id = p_subcontract_order_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'subcontract order % not found', p_subcontract_order_id;
  END IF;
  IF v_order.status <> 'draft' THEN
    RAISE EXCEPTION 'subcontract order % is not draft (status=%)', p_subcontract_order_id, v_order.status;
  END IF;

  FOR v_line IN SELECT * FROM subcontract_order_lines WHERE subcontract_order_id = p_subcontract_order_id LOOP
    v_unit_cost := fn_consume_cost_layers(
      p_tenant_id, v_order.warehouse_id, v_line.material_item_id, v_line.material_variant_id, v_line.quantity_sent
    );

    v_movement := fn_apply_stock_movement(
      p_tenant_id, v_order.warehouse_id, NULL, v_line.material_item_id, v_line.material_variant_id, NULL,
      'subcontract_out', 'out', v_line.quantity_sent, v_unit_cost,
      'subcontract_order', p_subcontract_order_id, p_actor_id
    );

    UPDATE subcontract_order_lines
       SET material_unit_cost = v_unit_cost, sent_movement_id = v_movement.id, updated_at = NOW()
     WHERE id = v_line.id;
  END LOOP;

  UPDATE subcontract_orders
     SET status = 'sent', sent_at = NOW(), updated_at = NOW()
   WHERE id = p_subcontract_order_id
   RETURNING * INTO v_order;

  PERFORM _emit_domain_event(
    p_tenant_id, 'inventory.subcontract_order.sent', 'subcontract_order', v_order.id,
    jsonb_build_object('supplier_id', v_order.supplier_id, 'warehouse_id', v_order.warehouse_id)
  );

  RETURN v_order;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- Receives every line's finished output back: total cost per line =
-- that line's own consumed material cost (quantity_sent * material_unit_cost,
-- from the send step) + its proportional share of subcontract_costs
-- (allocated by value across lines — the exact same "least invasive,
-- reuse existing primitives" allocation shape landed_costs already uses
-- for goods receipts, migration 110), divided by output_quantity. Posts a
-- real 'in' movement (fn_apply_stock_movement, unmodified) with the NEW
-- additive 'subcontract_in' type, and a real new cost layer
-- (fn_add_cost_layer, unmodified) — service cost genuinely included in
-- the returned product's valuation, not just recorded for reference.
-- quantity_returned defaults to the full quantity_sent (no partial-return
-- math invented beyond what was explicitly asked). sent/processing -> received.
-- =============================================================================
CREATE OR REPLACE FUNCTION fn_receive_subcontract_output(
  p_tenant_id            UUID,
  p_subcontract_order_id UUID,
  p_actor_id             UUID
) RETURNS subcontract_orders AS $$
DECLARE
  v_order subcontract_orders;
  v_line  RECORD;
  v_total_service_cost NUMERIC := 0;
  v_total_material_value NUMERIC := 0;
  v_line_material_value NUMERIC;
  v_output_unit_cost NUMERIC;
  v_movement stock_movements;
BEGIN
  SELECT * INTO v_order FROM subcontract_orders
   WHERE id = p_subcontract_order_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'subcontract order % not found', p_subcontract_order_id;
  END IF;
  IF v_order.status NOT IN ('sent', 'processing') THEN
    RAISE EXCEPTION 'subcontract order % is not sent or processing (status=%)', p_subcontract_order_id, v_order.status;
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_total_service_cost
    FROM subcontract_costs WHERE subcontract_order_id = p_subcontract_order_id;

  SELECT COALESCE(SUM(quantity_sent * COALESCE(material_unit_cost, 0)), 0) INTO v_total_material_value
    FROM subcontract_order_lines WHERE subcontract_order_id = p_subcontract_order_id;

  FOR v_line IN SELECT * FROM subcontract_order_lines WHERE subcontract_order_id = p_subcontract_order_id LOOP
    v_line_material_value := v_line.quantity_sent * COALESCE(v_line.material_unit_cost, 0);

    v_output_unit_cost := ROUND(
      (v_line_material_value + COALESCE(v_total_service_cost * v_line_material_value / NULLIF(v_total_material_value, 0), 0))
      / v_line.output_quantity,
      4
    );

    v_movement := fn_apply_stock_movement(
      p_tenant_id, v_order.warehouse_id, NULL, v_line.output_item_id, v_line.output_variant_id, NULL,
      'subcontract_in', 'in', v_line.output_quantity, v_output_unit_cost,
      'subcontract_order', p_subcontract_order_id, p_actor_id
    );

    PERFORM fn_add_cost_layer(
      p_tenant_id, v_order.warehouse_id, v_line.output_item_id, v_line.output_variant_id, NULL,
      v_line.output_quantity, v_output_unit_cost, v_movement.id
    );

    UPDATE subcontract_order_lines
       SET quantity_returned = COALESCE(quantity_returned, quantity_sent),
           output_unit_cost = v_output_unit_cost,
           received_movement_id = v_movement.id,
           updated_at = NOW()
     WHERE id = v_line.id;
  END LOOP;

  UPDATE subcontract_orders
     SET status = 'received', received_at = NOW(), updated_at = NOW()
   WHERE id = p_subcontract_order_id
   RETURNING * INTO v_order;

  PERFORM _emit_domain_event(
    p_tenant_id, 'inventory.subcontract_order.received', 'subcontract_order', v_order.id,
    jsonb_build_object('supplier_id', v_order.supplier_id, 'total_service_cost', v_total_service_cost)
  );

  RETURN v_order;
END;
$$ LANGUAGE plpgsql;
