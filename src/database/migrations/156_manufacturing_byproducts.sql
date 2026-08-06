-- Migration 13.16B — Roadmap #16 (Manufacturing) expansion: By-products.
-- Additive only — bill_of_materials, bom_lines, production_orders'
-- existing columns, fn_post_production_order, fn_apply_stock_movement,
-- fn_consume_cost_layers, fn_add_cost_layer, and every costing method are
-- all untouched (byte-for-byte, not redefined by this migration).
-- Subcontracting remains explicitly out of scope.
--
-- Note on the approved design doc's "production_orders.output_item_id":
-- no such column exists (confirmed during pre-implementation inspection —
-- the main output item has always been resolved via
-- production_orders.bom_id -> bill_of_materials.item_id). "Existing single
-- output behavior" below refers to that BOM-derived path, which this
-- migration does not touch in any way — the main product is still posted
-- exclusively by the unmodified fn_post_production_order.

-- One row per output (main product or by-product) a production order
-- produces. The main-product row is a purely informational record of what
-- fn_post_production_order already posted (inserted by the application
-- layer right after that unmodified call succeeds, movement_id pointing
-- at the exact same stock_movements row it created) — it does not drive
-- any new posting logic for the main item. by_product rows are the real
-- new capability: planned ahead via INSERT (movement_id NULL), then
-- received via fn_receive_production_output at completion time.
CREATE TABLE production_order_outputs (
  id                    UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  production_order_id   UUID          NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
  item_id               UUID          NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  variant_id            UUID          REFERENCES item_variants(id) ON DELETE RESTRICT,
  quantity              NUMERIC(14,4) NOT NULL CHECK (quantity > 0),
  unit_cost             NUMERIC(14,4) NOT NULL CHECK (unit_cost >= 0),
  output_type           TEXT          NOT NULL CHECK (output_type IN ('main_product', 'by_product')),
  movement_id           UUID          REFERENCES stock_movements(id),
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_po_outputs_order ON production_order_outputs(tenant_id, production_order_id);
ALTER TABLE production_order_outputs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON production_order_outputs
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.production_order_outputs TO service_role;

-- Receives a planned by-product output as a real inventory receipt.
-- Reuses movement_type='production_receipt' (NOT a new type) — a
-- by-product receipt is the same kind of event as the main product's
-- receipt, just a second/third item; this is the "use existing production
-- receipt patterns, do not create duplicate inventory systems" choice.
--
-- Costing (Phase 3, least-invasive method): by-products carry their own
-- independently-specified unit_cost (set when the output row is created,
-- e.g. "recovered material worth $2/kg") and get their own new cost_layer
-- via fn_add_cost_layer, exactly like any other receipt. The main
-- product's cost calculation inside fn_post_production_order
-- (total_component_cost / actual_qty) is completely unaffected — it is
-- not read, not modified, and no value is subtracted from it here. This
-- avoids touching the protected cost-allocation formula entirely, at the
-- cost of not doing a "split total component cost between outputs"
-- allocation — a deliberate, documented trade-off per "least invasive
-- method... prefer existing primitives."
CREATE OR REPLACE FUNCTION fn_receive_production_output(
  p_tenant_id    UUID,
  p_warehouse_id UUID,
  p_output_id    UUID,
  p_actor_id     UUID
) RETURNS production_order_outputs AS $$
DECLARE
  v_output production_order_outputs;
  v_movement stock_movements;
BEGIN
  SELECT * INTO v_output FROM production_order_outputs
   WHERE id = p_output_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'production order output % not found', p_output_id;
  END IF;
  IF v_output.movement_id IS NOT NULL THEN
    RAISE EXCEPTION 'production order output % has already been received', p_output_id;
  END IF;

  v_movement := fn_apply_stock_movement(
    p_tenant_id, p_warehouse_id, NULL, v_output.item_id, v_output.variant_id, NULL,
    'production_receipt', 'in', v_output.quantity, v_output.unit_cost,
    'production_order', v_output.production_order_id, p_actor_id
  );

  PERFORM fn_add_cost_layer(
    p_tenant_id, p_warehouse_id, v_output.item_id, v_output.variant_id, NULL,
    v_output.quantity, v_output.unit_cost, v_movement.id
  );

  UPDATE production_order_outputs
     SET movement_id = v_movement.id, updated_at = NOW()
   WHERE id = p_output_id
   RETURNING * INTO v_output;

  PERFORM _emit_domain_event(
    p_tenant_id, 'inventory.production_order.output_received', 'production_order', v_output.production_order_id,
    jsonb_build_object('output_id', v_output.id, 'item_id', v_output.item_id, 'quantity', v_output.quantity, 'output_type', v_output.output_type)
  );

  RETURN v_output;
END;
$$ LANGUAGE plpgsql;
