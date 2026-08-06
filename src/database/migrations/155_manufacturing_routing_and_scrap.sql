-- Migration 13.16A — Roadmap #16 (Manufacturing) expansion: Routing +
-- Scrap Tracking. Additive only — bill_of_materials, production_orders,
-- bom_lines, stock_movements' existing meanings, cost_layers, and
-- fn_post_production_order are all untouched (byte-for-byte, not
-- redefined by this migration). By-products and subcontracting are
-- explicitly out of scope, per approved decision.

-- =============================================================================
-- ROUTING — production_order_operations
-- =============================================================================
-- Purely descriptive/tracking metadata: an ordered list of operations a
-- production order goes through. No stock/cost effect of its own — the
-- one place it touches existing behavior is an OPTIONAL completion guard
-- (added at the application layer, not in fn_post_production_order
-- itself): if a production order has operations rows, they must all be
-- 'completed' before the order itself can complete. An order with zero
-- operations rows (every production order today, and any tenant who never
-- uses routing) is completely unaffected — this table is 100% opt-in.
CREATE TABLE production_order_operations (
  id                 UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  production_order_id UUID         NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
  work_center_id     UUID          REFERENCES work_centers(id) ON DELETE SET NULL,
  sequence           INTEGER       NOT NULL CHECK (sequence > 0),
  operation_name     TEXT          NOT NULL,
  duration_minutes   NUMERIC(10,2) CHECK (duration_minutes >= 0),
  status             TEXT          NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed')),
  started_at         TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
-- One sequence position per operation within a production order — keeps
-- ordering unambiguous (the "Cutting=1, Assembly=2, Finishing=3" example).
CREATE UNIQUE INDEX uq_po_operations_sequence ON production_order_operations(production_order_id, sequence);
CREATE INDEX idx_po_operations_order ON production_order_operations(tenant_id, production_order_id);
ALTER TABLE production_order_operations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON production_order_operations
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.production_order_operations TO service_role;

-- =============================================================================
-- SCRAP TRACKING — a distinct inventory event, not a replacement for
-- bom_lines.scrap_percentage (which remains exactly what it was: an
-- input-side over-consumption estimate applied inside
-- fn_post_production_order, completely untouched here).
-- =============================================================================

-- Additive only — every existing value keeps its exact prior meaning; no
-- existing row or caller is affected (same pattern as migration 095).
ALTER TABLE stock_movements
  DROP CONSTRAINT stock_movements_movement_type_check;
ALTER TABLE stock_movements
  ADD CONSTRAINT stock_movements_movement_type_check
  CHECK (movement_type IN (
    'receipt','sale','sale_return','adjustment_in','adjustment_out',
    'transfer_out','transfer_in','count_correction_in','count_correction_out',
    'purchase_return','damage','expiry','production_consumption','production_receipt',
    'production_scrap'
  ));

-- One row per recorded scrap event. item_id is intentionally not
-- constrained to a specific bom_lines component — a scrap event can be
-- either a raw material that was ruined during production or a defective
-- finished unit, both real scenarios; fn_record_production_scrap below
-- still validates the item exists and has real cost-layer stock to draw
-- from, same as any other real consumption.
CREATE TABLE production_order_scraps (
  id                   UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id            UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  production_order_id  UUID          NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
  item_id              UUID          NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  variant_id           UUID          REFERENCES item_variants(id) ON DELETE RESTRICT,
  quantity             NUMERIC(14,4) NOT NULL CHECK (quantity > 0),
  unit_cost            NUMERIC(14,4) NOT NULL CHECK (unit_cost >= 0),
  reason               TEXT,
  movement_id          UUID          REFERENCES stock_movements(id),
  created_by           UUID          REFERENCES users(id),
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_po_scraps_order ON production_order_scraps(tenant_id, production_order_id);
ALTER TABLE production_order_scraps ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON production_order_scraps
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.production_order_scraps TO service_role;

-- Records a scrap event as a real, distinct inventory-reducing movement —
-- reuses the EXISTING fn_consume_cost_layers/fn_apply_stock_movement
-- primitives exactly as fn_post_production_order does for consumption,
-- just with movement_type='production_scrap' instead of
-- 'production_consumption'/'production_receipt'. fn_post_production_order
-- itself is not called, read, or modified by this function — scrap is
-- recorded as its own, independent call, optionally orchestrated by the
-- application layer alongside (not inside) completion.
CREATE OR REPLACE FUNCTION fn_record_production_scrap(
  p_tenant_id            UUID,
  p_warehouse_id         UUID,
  p_production_order_id  UUID,
  p_item_id              UUID,
  p_variant_id           UUID,
  p_quantity             NUMERIC,
  p_reason               TEXT,
  p_actor_id             UUID
) RETURNS production_order_scraps AS $$
DECLARE
  v_order production_orders;
  v_unit_cost NUMERIC;
  v_movement stock_movements;
  v_scrap production_order_scraps;
BEGIN
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'scrap quantity must be positive';
  END IF;

  SELECT * INTO v_order FROM production_orders
   WHERE id = p_production_order_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'production order % not found', p_production_order_id;
  END IF;
  IF v_order.status NOT IN ('in_progress', 'completed') THEN
    RAISE EXCEPTION 'production order % must be in_progress or completed to record scrap (status=%)', p_production_order_id, v_order.status;
  END IF;

  v_unit_cost := fn_consume_cost_layers(
    p_tenant_id, p_warehouse_id, p_item_id, p_variant_id, p_quantity
  );

  v_movement := fn_apply_stock_movement(
    p_tenant_id, p_warehouse_id, NULL, p_item_id, p_variant_id, NULL,
    'production_scrap', 'out', p_quantity, v_unit_cost,
    'production_order', p_production_order_id, p_actor_id
  );

  INSERT INTO production_order_scraps (
    tenant_id, production_order_id, item_id, variant_id, quantity, unit_cost, reason, movement_id, created_by
  ) VALUES (
    p_tenant_id, p_production_order_id, p_item_id, p_variant_id, p_quantity, v_unit_cost, p_reason, v_movement.id, p_actor_id
  ) RETURNING * INTO v_scrap;

  PERFORM _emit_domain_event(
    p_tenant_id, 'inventory.production_order.scrap_recorded', 'production_order', p_production_order_id,
    jsonb_build_object('item_id', p_item_id, 'variant_id', p_variant_id, 'quantity', p_quantity, 'unit_cost', v_unit_cost)
  );

  RETURN v_scrap;
END;
$$ LANGUAGE plpgsql;
