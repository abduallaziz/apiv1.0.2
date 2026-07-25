-- Inventory redesign — item #7: WMS operations (picking/packing/shipping),
-- with 4 picking strategies (single/batch/wave/zone).
--
-- Scope decision (confirmed with user): no `sales_orders` concept exists
-- yet — POS deducts stock immediately at sale time, and the only other
-- multi-step outbound flow today is stock_transfers. Rather than forking
-- either, this is a generic reusable overlay: `shipments` /
-- `shipment_lines` reference ANY source document via
-- (reference_type, reference_id) — today that's 'stock_transfer', later
-- it could be a sales_order once one exists — with zero coupling to the
-- referenced table's own schema.
--
-- Picking never moves stock directly: it reuses the EXISTING
-- fn_create_reservation/fn_release_reservation (migration 019) to hold
-- the picked quantity so it can't be double-allocated to another
-- shipment concurrently. The actual stock movement (e.g. a transfer's
-- own dispatch call) remains the referenced document's own
-- responsibility — this layer is pure process tracking + reservation,
-- never a second source of truth for what happened to stock.

CREATE TABLE shipments (
  id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  warehouse_id   UUID        NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  reference_type TEXT        NOT NULL,
  reference_id   UUID        NOT NULL,
  status         TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','picking','picked','packing','packed','shipped','cancelled')),
  tracking_number TEXT,
  created_by     UUID        REFERENCES users(id),
  shipped_at     TIMESTAMPTZ,
  deleted_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_shipments_tenant_status ON shipments(tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_shipments_reference ON shipments(tenant_id, reference_type, reference_id);
ALTER TABLE shipments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON shipments
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.shipments TO service_role;

CREATE TABLE shipment_lines (
  id                 UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  shipment_id        UUID          NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  item_id            UUID          NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  variant_id         UUID          REFERENCES item_variants(id) ON DELETE RESTRICT,
  location_id        UUID          REFERENCES warehouse_locations(id) ON DELETE SET NULL,
  quantity_requested NUMERIC(14,4) NOT NULL CHECK (quantity_requested > 0),
  quantity_picked    NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (quantity_picked >= 0),
  quantity_packed    NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (quantity_packed >= 0),
  reservation_id     UUID          REFERENCES stock_reservations(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_shipment_line_picked_le_requested CHECK (quantity_picked <= quantity_requested),
  CONSTRAINT chk_shipment_line_packed_le_picked CHECK (quantity_packed <= quantity_picked)
);
CREATE INDEX idx_shipment_lines_shipment ON shipment_lines(shipment_id);
ALTER TABLE shipment_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON shipment_lines
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.shipment_lines TO service_role;

CREATE TABLE pick_lists (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  warehouse_id     UUID        NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  strategy         TEXT        NOT NULL CHECK (strategy IN ('single','batch','wave','zone')),
  zone_location_id UUID        REFERENCES warehouse_locations(id) ON DELETE SET NULL,
  status           TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','completed','cancelled')),
  assigned_to      UUID        REFERENCES users(id),
  created_by       UUID        REFERENCES users(id),
  deleted_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  -- 'zone' strategy must pin a zone-typed location; other strategies never do.
  CONSTRAINT chk_pick_list_zone_requires_location CHECK (
    (strategy = 'zone' AND zone_location_id IS NOT NULL) OR
    (strategy <> 'zone' AND zone_location_id IS NULL)
  )
);
CREATE INDEX idx_pick_lists_tenant_status ON pick_lists(tenant_id, status) WHERE deleted_at IS NULL;
ALTER TABLE pick_lists ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON pick_lists
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.pick_lists TO service_role;

-- Which shipments a pick list covers — 'single' always has exactly one row,
-- 'batch'/'wave'/'zone' can span several shipments picked together.
CREATE TABLE pick_list_shipments (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  pick_list_id UUID        NOT NULL REFERENCES pick_lists(id) ON DELETE CASCADE,
  shipment_id  UUID        NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (pick_list_id, shipment_id)
);
ALTER TABLE pick_list_shipments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON pick_list_shipments
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.pick_list_shipments TO service_role;

-- What a picker actually walks the warehouse with: one row per
-- item/variant/location, consolidated across every shipment_line in the
-- pick list — a batch of 5 orders each needing 2 units of the same SKU
-- becomes ONE line to pick 10 units, not 5 separate walks to the same shelf.
CREATE TABLE pick_list_lines (
  id               UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  pick_list_id     UUID          NOT NULL REFERENCES pick_lists(id) ON DELETE CASCADE,
  item_id          UUID          NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  variant_id       UUID          REFERENCES item_variants(id) ON DELETE RESTRICT,
  location_id      UUID          REFERENCES warehouse_locations(id) ON DELETE SET NULL,
  quantity_to_pick NUMERIC(14,4) NOT NULL CHECK (quantity_to_pick > 0),
  quantity_picked  NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (quantity_picked >= 0),
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_pick_list_line_picked_le_needed CHECK (quantity_picked <= quantity_to_pick)
);
CREATE INDEX idx_pick_list_lines_list ON pick_list_lines(pick_list_id);
ALTER TABLE pick_list_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON pick_list_lines
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.pick_list_lines TO service_role;

-- Builds a pick list for one or more pending shipments (all must belong to
-- the same warehouse and be status='pending'). Consolidates their lines by
-- (item_id, variant_id, location_id) into pick_list_lines, and reserves the
-- consolidated quantity via the EXISTING fn_create_reservation for each
-- resulting line (reference_type='pick_list_line') so concurrent picking
-- against the same stock can't double-allocate. Moves every covered
-- shipment to status='picking'.
CREATE OR REPLACE FUNCTION fn_create_pick_list(
  p_tenant_id        UUID,
  p_warehouse_id     UUID,
  p_shipment_ids     UUID[],
  p_strategy         TEXT,
  p_zone_location_id UUID,
  p_actor_id         UUID
) RETURNS pick_lists AS $$
DECLARE
  v_pick_list pick_lists;
  v_shipment  shipments;
  v_line      RECORD;
  v_pll       pick_list_lines;
  v_reservation stock_reservations;
BEGIN
  IF array_length(p_shipment_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'at least one shipment is required';
  END IF;
  IF p_strategy = 'single' AND array_length(p_shipment_ids, 1) <> 1 THEN
    RAISE EXCEPTION 'strategy single requires exactly one shipment';
  END IF;

  INSERT INTO pick_lists (tenant_id, warehouse_id, strategy, zone_location_id, status, created_by, started_at)
  VALUES (p_tenant_id, p_warehouse_id, p_strategy, p_zone_location_id, 'in_progress', p_actor_id, NOW())
  RETURNING * INTO v_pick_list;

  FOR v_shipment IN SELECT * FROM shipments WHERE id = ANY(p_shipment_ids) FOR UPDATE LOOP
    IF v_shipment.tenant_id <> p_tenant_id THEN
      RAISE EXCEPTION 'shipment % not found', v_shipment.id;
    END IF;
    IF v_shipment.warehouse_id <> p_warehouse_id THEN
      RAISE EXCEPTION 'shipment % does not belong to warehouse %', v_shipment.id, p_warehouse_id;
    END IF;
    IF v_shipment.status <> 'pending' THEN
      RAISE EXCEPTION 'shipment % is not pending (status=%)', v_shipment.id, v_shipment.status;
    END IF;

    INSERT INTO pick_list_shipments (tenant_id, pick_list_id, shipment_id)
    VALUES (p_tenant_id, v_pick_list.id, v_shipment.id);

    UPDATE shipments SET status = 'picking', updated_at = NOW() WHERE id = v_shipment.id;
  END LOOP;

  FOR v_line IN
    SELECT sl.item_id, sl.variant_id, sl.location_id, SUM(sl.quantity_requested) AS total_qty
    FROM shipment_lines sl
    WHERE sl.shipment_id = ANY(p_shipment_ids)
    GROUP BY sl.item_id, sl.variant_id, sl.location_id
  LOOP
    INSERT INTO pick_list_lines (tenant_id, pick_list_id, item_id, variant_id, location_id, quantity_to_pick)
    VALUES (p_tenant_id, v_pick_list.id, v_line.item_id, v_line.variant_id, v_line.location_id, v_line.total_qty)
    RETURNING * INTO v_pll;

    v_reservation := fn_create_reservation(
      p_tenant_id, p_warehouse_id, v_line.item_id, v_line.variant_id, NULL,
      v_line.total_qty, 'pick_list_line', v_pll.id, p_actor_id, NULL
    );

    -- Fan the single consolidated reservation back out across every
    -- shipment_line it covers so each shipment can later be released
    -- independently at ship time.
    UPDATE shipment_lines
       SET reservation_id = v_reservation.id
     WHERE shipment_id = ANY(p_shipment_ids)
       AND item_id = v_line.item_id
       AND COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(v_line.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
       AND COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(v_line.location_id, '00000000-0000-0000-0000-000000000000'::uuid);
  END LOOP;

  RETURN v_pick_list;
END;
$$ LANGUAGE plpgsql;

-- Confirms a picker actually picked p_quantity for one consolidated
-- pick_list_line. Distributes the picked amount across the underlying
-- shipment_lines (FIFO by shipment creation order) so each shipment's own
-- quantity_picked stays accurate for packing. Completes the pick list (and
-- flips every covered shipment to 'picked') once every line is fully picked.
CREATE OR REPLACE FUNCTION fn_confirm_pick(
  p_pick_list_line_id UUID,
  p_quantity          NUMERIC,
  p_actor_id          UUID
) RETURNS pick_list_lines AS $$
DECLARE
  v_line pick_list_lines;
  v_remaining NUMERIC;
  v_sl RECORD;
  v_take NUMERIC;
  v_pick_list_id UUID;
  v_shipment_ids UUID[];
  v_all_done BOOLEAN;
BEGIN
  SELECT * INTO v_line FROM pick_list_lines WHERE id = p_pick_list_line_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pick list line % not found', p_pick_list_line_id;
  END IF;
  IF v_line.quantity_picked + p_quantity > v_line.quantity_to_pick THEN
    RAISE EXCEPTION 'cannot pick % — only % remaining of %', p_quantity, v_line.quantity_to_pick - v_line.quantity_picked, v_line.quantity_to_pick;
  END IF;

  UPDATE pick_list_lines SET quantity_picked = quantity_picked + p_quantity WHERE id = p_pick_list_line_id
  RETURNING * INTO v_line;

  SELECT array_agg(shipment_id) INTO v_shipment_ids FROM pick_list_shipments WHERE pick_list_id = v_line.pick_list_id;

  v_remaining := p_quantity;
  FOR v_sl IN
    SELECT sl.* FROM shipment_lines sl
    JOIN shipments s ON s.id = sl.shipment_id
    WHERE sl.shipment_id = ANY(v_shipment_ids)
      AND sl.item_id = v_line.item_id
      AND COALESCE(sl.variant_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(v_line.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND COALESCE(sl.location_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(v_line.location_id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND sl.quantity_picked < sl.quantity_requested
    ORDER BY s.created_at ASC
    FOR UPDATE OF sl
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_take := LEAST(v_remaining, v_sl.quantity_requested - v_sl.quantity_picked);
    UPDATE shipment_lines SET quantity_picked = quantity_picked + v_take WHERE id = v_sl.id;
    v_remaining := v_remaining - v_take;
  END LOOP;

  -- Move any shipment whose every line is now fully picked to 'picked'.
  FOR v_pick_list_id IN SELECT unnest(v_shipment_ids) LOOP
    SELECT NOT EXISTS (
      SELECT 1 FROM shipment_lines WHERE shipment_id = v_pick_list_id AND quantity_picked < quantity_requested
    ) INTO v_all_done;
    IF v_all_done THEN
      UPDATE shipments SET status = 'picked', updated_at = NOW() WHERE id = v_pick_list_id AND status = 'picking';
    END IF;
  END LOOP;

  SELECT NOT EXISTS (
    SELECT 1 FROM pick_list_lines WHERE pick_list_id = v_line.pick_list_id AND quantity_picked < quantity_to_pick
  ) INTO v_all_done;
  IF v_all_done THEN
    UPDATE pick_lists SET status = 'completed', completed_at = NOW() WHERE id = v_line.pick_list_id;
  END IF;

  RETURN v_line;
END;
$$ LANGUAGE plpgsql;

-- Confirms packing for one shipment_line (cannot exceed what was picked).
-- Advances the shipment to 'packing' on first pack, 'packed' once every
-- line is fully packed.
CREATE OR REPLACE FUNCTION fn_confirm_pack(
  p_shipment_line_id UUID,
  p_quantity         NUMERIC,
  p_actor_id         UUID
) RETURNS shipment_lines AS $$
DECLARE
  v_line shipment_lines;
  v_shipment shipments;
  v_all_packed BOOLEAN;
BEGIN
  SELECT * INTO v_line FROM shipment_lines WHERE id = p_shipment_line_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shipment line % not found', p_shipment_line_id;
  END IF;

  SELECT * INTO v_shipment FROM shipments WHERE id = v_line.shipment_id FOR UPDATE;
  IF v_shipment.status NOT IN ('picked', 'packing') THEN
    RAISE EXCEPTION 'shipment % is not picked/packing (status=%)', v_shipment.id, v_shipment.status;
  END IF;
  IF v_line.quantity_packed + p_quantity > v_line.quantity_picked THEN
    RAISE EXCEPTION 'cannot pack % — only % picked-but-unpacked remaining', p_quantity, v_line.quantity_picked - v_line.quantity_packed;
  END IF;

  UPDATE shipment_lines SET quantity_packed = quantity_packed + p_quantity WHERE id = p_shipment_line_id
  RETURNING * INTO v_line;

  UPDATE shipments SET status = 'packing', updated_at = NOW() WHERE id = v_shipment.id AND status = 'picked';

  SELECT NOT EXISTS (
    SELECT 1 FROM shipment_lines WHERE shipment_id = v_shipment.id AND quantity_packed < quantity_picked
  ) INTO v_all_packed;
  IF v_all_packed THEN
    UPDATE shipments SET status = 'packed', updated_at = NOW() WHERE id = v_shipment.id;
  END IF;

  RETURN v_line;
END;
$$ LANGUAGE plpgsql;

-- Ships a fully packed shipment: releases every reservation it (partially
-- or fully) holds as 'consumed' — the referenced document (e.g. a stock
-- transfer's own dispatch call) remains solely responsible for the actual
-- stock_movement; this function only ever touches shipments/reservations.
CREATE OR REPLACE FUNCTION fn_ship_shipment(
  p_shipment_id     UUID,
  p_actor_id        UUID,
  p_tracking_number TEXT DEFAULT NULL
) RETURNS shipments AS $$
DECLARE
  v_shipment shipments;
  v_reservation_id UUID;
BEGIN
  SELECT * INTO v_shipment FROM shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shipment % not found', p_shipment_id;
  END IF;
  IF v_shipment.status <> 'packed' THEN
    RAISE EXCEPTION 'shipment % is not packed (status=%)', p_shipment_id, v_shipment.status;
  END IF;

  FOR v_reservation_id IN
    SELECT DISTINCT reservation_id FROM shipment_lines WHERE shipment_id = p_shipment_id AND reservation_id IS NOT NULL
  LOOP
    -- Only consume once every shipment sharing this reservation (batch/wave)
    -- has actually shipped — a reservation covers the consolidated pick
    -- quantity across potentially several shipments.
    IF NOT EXISTS (
      SELECT 1 FROM shipment_lines
      WHERE reservation_id = v_reservation_id AND shipment_id <> p_shipment_id
        AND shipment_id IN (SELECT id FROM shipments WHERE status <> 'shipped' AND status <> 'cancelled')
    ) THEN
      PERFORM fn_release_reservation(v_reservation_id, 'consumed');
    END IF;
  END LOOP;

  UPDATE shipments
     SET status = 'shipped', shipped_at = NOW(), tracking_number = COALESCE(p_tracking_number, tracking_number), updated_at = NOW()
   WHERE id = p_shipment_id
   RETURNING * INTO v_shipment;

  PERFORM _emit_domain_event(
    v_shipment.tenant_id, 'inventory.shipment.shipped', 'shipment', v_shipment.id,
    jsonb_build_object('reference_type', v_shipment.reference_type, 'reference_id', v_shipment.reference_id)
  );

  RETURN v_shipment;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_cancel_shipment(p_shipment_id UUID, p_tenant_id UUID) RETURNS shipments AS $$
DECLARE
  v_shipment shipments;
  v_reservation_id UUID;
BEGIN
  SELECT * INTO v_shipment FROM shipments WHERE id = p_shipment_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shipment % not found', p_shipment_id;
  END IF;
  IF v_shipment.status = 'shipped' THEN
    RAISE EXCEPTION 'shipment % is already shipped, cannot cancel', p_shipment_id;
  END IF;

  FOR v_reservation_id IN
    SELECT DISTINCT reservation_id FROM shipment_lines WHERE shipment_id = p_shipment_id AND reservation_id IS NOT NULL
  LOOP
    PERFORM fn_release_reservation(v_reservation_id, 'released');
  END LOOP;

  UPDATE shipments SET status = 'cancelled', updated_at = NOW() WHERE id = p_shipment_id RETURNING * INTO v_shipment;
  RETURN v_shipment;
END;
$$ LANGUAGE plpgsql;
