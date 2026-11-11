-- 239. Inventory #7 / Migration Item 7-7 (Owner-approved) — Exception
-- Handling Primitives: short pick, damaged, lost, cancellation.
--
-- Builds on 7-1 (warehouse_work_status_history/audit_logs), 7-2
-- (fn_confirm_pick/fn_create_pick_list), 7-6 (fn_release_wave). Reuses
-- rather than duplicates: fn_apply_stock_movement (the sole stock-mutation
-- engine — damage/lost never touch stock_levels directly), fn_create_
-- reservation (unchanged), the wave_shipments included_reason/excluded_
-- reason JSONB convention (mirrored here as warehouse_exceptions.notes).
--
-- ARCHITECTURE DECISIONS (documented, not silently assumed):
--
-- 1. LOST ITEM ACCOUNTING (Owner-approved, explicit decision — damage has
--    an established Sefay precedent, lost did not, so this was asked
--    rather than invented): a lost item is treated as a real, immediate
--    inventory write-off — 'lost' is a new stock_movements.movement_type
--    using the ALREADY-GENERIC 'out' branch of fn_apply_stock_movement
--    (no branch changes needed: 'lost' simply isn't in the special
--    damage/expiry/quality_hold reclassify-list, so it automatically
--    decrements quantity_on_hand for real, with a full ledger row,
--    before/after snapshot, and real FIFO cost-layer consumption via
--    fn_consume_cost_layers — the exact same mechanism a real sale
--    already uses). Recovery (an item later found) is explicitly NOT a
--    silent history reversal — it is a separate corrective 'receipt'
--    movement, exactly like any other physical stock correction; nothing
--    in this migration lets a 'lost' movement be un-recorded.
--
-- 2. DAMAGE keeps its pre-existing Sefay treatment exactly as it already
--    was (migration 104/163): reclassify into quantity_damaged, stay on
--    quantity_on_hand, excluded from availability — a damaged item is
--    still physically present pending disposition. This is NOT a new
--    decision, it's reuse of an existing, already-approved primitive
--    (fn_apply_stock_movement's damage branch is untouched by this
--    migration). Cost layers are deliberately NOT consumed for damage
--    (matching the existing damage/expiry/quality_hold branch, which has
--    never consumed cost layers for any of these three types) — the
--    ledger's unit_cost is a read-only weighted-average lookup for
--    record-keeping, not a layer consumption, since a damaged item is not
--    removed from stock the way a lost or sold one is.
--
-- 3. SHORT PICK: no accounting event at all (nothing was physically
--    removed) — purely a reservation and fulfillment-tracking correction.
--    "requested = picked + short" is enforced by construction: short is
--    always computed as quantity_requested - quantity_picked -
--    quantity_exception at the moment of finalization and stored
--    immutably on the exception row; quantity_requested itself is never
--    mutated (7-7 §4's explicit requirement).
--
-- 4. FULFILLMENT POLICY (Owner-approved, already given as 7-7 §5):
--    Partial Fulfillment + Backorder. A finalized short pick reduces the
--    line's reservation by exactly the short amount (freeing that
--    capacity — it will never be picked from this allocation) and
--    records the shortfall as an auditable exception with
--    resolution='backordered'. Sefay's existing `backorders` table
--    (105_backorders.sql) is an ORDER/sales-level concept tied to
--    fn_apply_stock_movement's own p_allow_backorder branch — this
--    migration does not fabricate a link into that separate domain (no
--    evidence exists that a WMS shipment's reference_id reliably maps to
--    a sales order at this layer); the warehouse-side backorder record
--    IS the warehouse_exceptions row itself (exception_type, affected_
--    quantity, resolution='backordered') — fully auditable, not
--    duplicating or bypassing the order-level backorders table, which
--    remains free to reconcile against this data in a later phase.
--
-- 5. A single outstanding-quantity pool per shipment_line
--    (quantity_requested = quantity_picked + quantity_exception +
--    still-outstanding) is the one invariant every exception type
--    (short/damaged/lost) enforces via CHECK, mirroring the existing
--    over-pick guard style already used by fn_confirm_pick/fn_confirm_pack.
--    This is also what makes duplicate/repeated exception submission
--    safe without inventing a separate idempotency-key mechanism: a
--    second call attempting to double-count against an already-exhausted
--    pool fails the same CHECK a genuine double entry would.
--
-- 6. Every exception (short/damaged/lost/cancelled) is recorded already
--    resolved (status='resolved' at INSERT time) — the recording and its
--    consequence (reservation reduction, stock movement, cancellation)
--    happen atomically in the same transaction; there is no pending
--    human-review step defined anywhere in the approved Sefay lifecycle
--    today, and building one here would be exactly the "fake workflow
--    merely to satisfy the schema" 7-7 §11 explicitly warns against. The
--    status/resolution columns are kept open-ended for a future phase to
--    add a real review workflow without a schema redesign.
--
-- 7. warehouse_work_status_history.entity_type is widened to add
--    'shipment' (needed: shipment-level transitions — settling as
--    'picked' after a short/damaged/lost finalization, and cancellation —
--    have never been historized before; extending the existing shared
--    primitive's vocabulary, per 7-1's own mandate, not creating a
--    competing history mechanism).
--
-- 8. fn_cancel_shipment is reconciled to the same reason/actor/history
--    contract fn_cancel_pick_list and fn_cancel_wave already use
--    (previously it took neither p_reason nor p_actor_id and wrote no
--    history at all — a genuine inconsistency discovered during this
--    item's own architectural audit, not new scope) and made genuinely
--    idempotent (repeat cancellation of an already-cancelled shipment is
--    now a no-op instead of silently re-running reservation release).

-- ---------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------

ALTER TABLE warehouse_work_status_history
  DROP CONSTRAINT warehouse_work_status_history_entity_type_check,
  ADD CONSTRAINT warehouse_work_status_history_entity_type_check
    CHECK (entity_type IN ('warehouse_task', 'pick_list', 'wave', 'shipment'));

ALTER TABLE stock_movements
  DROP CONSTRAINT stock_movements_movement_type_check,
  ADD CONSTRAINT stock_movements_movement_type_check
  CHECK (movement_type IN (
    'receipt','sale','sale_return','adjustment_in','adjustment_out',
    'transfer_out','transfer_in','count_correction_in','count_correction_out',
    'purchase_return','damage','expiry','production_consumption','production_receipt',
    'production_scrap','subcontract_out','subcontract_in',
    'quality_hold','quality_release','lost'
  ));

ALTER TABLE shipment_lines
  ADD COLUMN quantity_exception NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (quantity_exception >= 0);
ALTER TABLE shipment_lines
  ADD CONSTRAINT chk_shipment_line_exception_within_requested
    CHECK (quantity_picked + quantity_exception <= quantity_requested);

ALTER TABLE shipments ADD COLUMN cancellation_reason TEXT;

-- Structured exception record — mirrors the wave_shipments included_
-- reason/excluded_reason JSONB convention (230_wave_data_model.sql) via
-- the `notes` column, but as a real append-only table rather than a
-- mutually-exclusive pair of columns, since (a) an entity can accumulate
-- more than one exception over its lifetime (a line can be short-picked
-- AND separately have a different unit damaged), and (b) exceptions need
-- their own queryable history for 7-8, not just a single current-state
-- blob on the parent row.
CREATE TABLE warehouse_exceptions (
  id                 UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type        TEXT        NOT NULL CHECK (entity_type IN ('shipment_line', 'shipment', 'pick_list', 'pick_list_line', 'wave')),
  entity_id          UUID        NOT NULL,
  exception_type     TEXT        NOT NULL CHECK (exception_type IN ('short_pick', 'damaged', 'lost', 'cancelled')),
  affected_quantity  NUMERIC(14,4) CHECK (affected_quantity IS NULL OR affected_quantity >= 0),
  reason             TEXT        NOT NULL,
  notes              JSONB       NOT NULL DEFAULT '{}'::jsonb,
  actor_id           UUID        REFERENCES users(id),
  status             TEXT        NOT NULL DEFAULT 'resolved' CHECK (status IN ('open', 'resolved')),
  resolution         TEXT,
  resolved_at        TIMESTAMPTZ,
  resolved_by        UUID        REFERENCES users(id),
  stock_movement_id  UUID        REFERENCES stock_movements(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_warehouse_exception_resolved_matches_status
    CHECK ((status = 'resolved') = (resolved_at IS NOT NULL)),
  CONSTRAINT chk_warehouse_exception_reason_not_blank
    CHECK (btrim(reason) <> '')
);
CREATE INDEX idx_warehouse_exceptions_entity ON warehouse_exceptions(tenant_id, entity_type, entity_id);
CREATE INDEX idx_warehouse_exceptions_type ON warehouse_exceptions(tenant_id, exception_type);
ALTER TABLE warehouse_exceptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON warehouse_exceptions
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.warehouse_exceptions TO service_role;

-- ---------------------------------------------------------------------
-- fn_reduce_reservation — the missing reservation primitive the audit
-- identified: partial-quantity release, needed whenever an exception
-- makes only PART of a reservation's covered quantity unfulfillable.
-- Reuses _lock_or_create_stock_level exactly as fn_release_reservation
-- does; when the reduction exhausts the reservation entirely, it
-- transitions to 'released' the same way fn_release_reservation already
-- does (never zeroes `quantity`, which fn_release_reservation also never
-- does — the CHECK(quantity>0) applies regardless of status).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_reduce_reservation(
  p_reservation_id UUID,
  p_quantity       NUMERIC,
  p_actor_id       UUID
) RETURNS stock_reservations AS $$
DECLARE
  v_reservation stock_reservations;
  v_level       stock_levels;
BEGIN
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'quantity must be positive, got %', p_quantity;
  END IF;

  SELECT * INTO v_reservation FROM stock_reservations WHERE id = p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservation % not found', p_reservation_id;
  END IF;
  IF v_reservation.status <> 'active' THEN
    RAISE EXCEPTION 'reservation % is not active (status=%)', p_reservation_id, v_reservation.status;
  END IF;
  IF p_quantity > v_reservation.quantity THEN
    RAISE EXCEPTION 'RESERVATION_REDUCE_EXCEEDS_QUANTITY: cannot reduce % — only % remains reserved on %', p_quantity, v_reservation.quantity, p_reservation_id;
  END IF;

  v_level := _lock_or_create_stock_level(
    v_reservation.tenant_id, v_reservation.warehouse_id, NULL,
    v_reservation.item_id, v_reservation.variant_id, v_reservation.batch_id
  );

  UPDATE stock_levels
     SET quantity_reserved = quantity_reserved - p_quantity,
         version = version + 1,
         updated_at = NOW()
   WHERE id = v_level.id;

  IF p_quantity = v_reservation.quantity THEN
    UPDATE stock_reservations SET status = 'released', released_at = NOW()
     WHERE id = p_reservation_id
     RETURNING * INTO v_reservation;
  ELSE
    UPDATE stock_reservations SET quantity = quantity - p_quantity
     WHERE id = p_reservation_id
     RETURNING * INTO v_reservation;
  END IF;

  PERFORM _emit_domain_event(
    v_reservation.tenant_id, 'inventory.reservation.reduced', 'stock_reservation', v_reservation.id,
    jsonb_build_object('reduced_by', p_quantity, 'remaining', v_reservation.quantity, 'actor_id', p_actor_id)
  );

  RETURN v_reservation;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- fn_record_short_pick — finalizes a shipment line as short: the
-- outstanding (never-picked) quantity is recorded as a backordered
-- exception, its reservation share is freed, and the shipment/pick list
-- are advanced past their "wait for full pick" gate if this was the last
-- thing blocking them. Idempotent by construction: a second call once
-- the line has zero outstanding quantity raises NOT_SHORT rather than
-- double-recording.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_record_short_pick(
  p_shipment_line_id UUID,
  p_tenant_id        UUID,
  p_reason           TEXT,
  p_actor_id         UUID
) RETURNS warehouse_exceptions AS $$
DECLARE
  v_line       shipment_lines;
  v_shipment   shipments;
  v_outstanding NUMERIC;
  v_exception  warehouse_exceptions;
  v_pick_list_id UUID;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'a reason is required';
  END IF;

  SELECT * INTO v_line FROM shipment_lines WHERE id = p_shipment_line_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shipment line % not found', p_shipment_line_id;
  END IF;

  SELECT * INTO v_shipment FROM shipments WHERE id = v_line.shipment_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shipment line % not found', p_shipment_line_id;
  END IF;
  IF v_shipment.status <> 'picking' THEN
    RAISE EXCEPTION 'shipment % is not in a pickable state (status=%) — short pick can only be finalized while picking', v_shipment.id, v_shipment.status;
  END IF;

  v_outstanding := v_line.quantity_requested - v_line.quantity_picked - v_line.quantity_exception;
  IF v_outstanding <= 0 THEN
    RAISE EXCEPTION 'NOT_SHORT: shipment line % has no outstanding quantity to finalize as short', p_shipment_line_id;
  END IF;

  IF v_line.reservation_id IS NOT NULL THEN
    PERFORM fn_reduce_reservation(v_line.reservation_id, v_outstanding, p_actor_id);
  END IF;

  UPDATE shipment_lines SET quantity_exception = quantity_exception + v_outstanding WHERE id = p_shipment_line_id;

  INSERT INTO warehouse_exceptions (
    tenant_id, entity_type, entity_id, exception_type, affected_quantity, reason,
    notes, actor_id, status, resolution, resolved_at, resolved_by
  ) VALUES (
    p_tenant_id, 'shipment_line', p_shipment_line_id, 'short_pick', v_outstanding, p_reason,
    jsonb_build_object('requested', v_line.quantity_requested, 'picked', v_line.quantity_picked, 'shipment_id', v_shipment.id),
    p_actor_id, 'resolved', 'backordered', NOW(), p_actor_id
  ) RETURNING * INTO v_exception;

  -- Advance shipment to 'picked' if every line is now settled — either
  -- genuinely fully picked, or its outstanding quantity has been
  -- accounted for by an exception (short/damaged/lost). Mirrors
  -- fn_confirm_pick's own "all done" check, extended with the exception
  -- pool.
  IF NOT EXISTS (
    SELECT 1 FROM shipment_lines
     WHERE shipment_id = v_shipment.id
       AND quantity_picked + quantity_exception < quantity_requested
  ) THEN
    UPDATE shipments SET status = 'picked', updated_at = NOW() WHERE id = v_shipment.id AND status = 'picking';
    INSERT INTO warehouse_work_status_history (tenant_id, entity_type, entity_id, old_status, new_status, actor_id, notes)
    VALUES (p_tenant_id, 'shipment', v_shipment.id, 'picking', 'picked', p_actor_id, 'settled with short pick(s)');
  END IF;

  -- Pick list is fully settled once every shipment_line across every
  -- shipment it covers is either genuinely fully picked or accounted for
  -- by an exception — simpler and equivalent to re-deriving the same
  -- check through pick_list_lines' own aggregate grouping.
  SELECT pick_list_id INTO v_pick_list_id FROM pick_list_shipments WHERE shipment_id = v_shipment.id LIMIT 1;
  IF v_pick_list_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM shipment_lines sl2
    JOIN pick_list_shipments pls2 ON pls2.shipment_id = sl2.shipment_id
    WHERE pls2.pick_list_id = v_pick_list_id
      AND sl2.quantity_picked + sl2.quantity_exception < sl2.quantity_requested
  ) THEN
    UPDATE pick_lists SET status = 'completed', completed_at = NOW(), updated_at = NOW() WHERE id = v_pick_list_id AND status = 'in_progress';
    INSERT INTO warehouse_work_status_history (tenant_id, entity_type, entity_id, old_status, new_status, actor_id, notes)
    VALUES (p_tenant_id, 'pick_list', v_pick_list_id, 'in_progress', 'completed', p_actor_id, 'settled with short pick(s)');
  END IF;

  RETURN v_exception;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- fn_record_damage — a portion of a shipment line's outstanding (not
-- yet picked) quantity is found damaged at/before the pick. Reuses
-- fn_apply_stock_movement's existing 'damage' branch verbatim (reclassify
-- into quantity_damaged, stay on quantity_on_hand) — no new accounting
-- behavior. Cost layers are read (weighted average) but not consumed,
-- matching the existing damage/expiry/quality_hold convention exactly.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_record_damage(
  p_shipment_line_id UUID,
  p_tenant_id        UUID,
  p_quantity         NUMERIC,
  p_reason           TEXT,
  p_actor_id         UUID
) RETURNS warehouse_exceptions AS $$
DECLARE
  v_line       shipment_lines;
  v_shipment   shipments;
  v_outstanding NUMERIC;
  v_unit_cost  NUMERIC;
  v_movement   stock_movements;
  v_exception  warehouse_exceptions;
  v_pick_list_id UUID;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'a reason is required';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'quantity must be positive, got %', p_quantity;
  END IF;

  SELECT * INTO v_line FROM shipment_lines WHERE id = p_shipment_line_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shipment line % not found', p_shipment_line_id;
  END IF;
  SELECT * INTO v_shipment FROM shipments WHERE id = v_line.shipment_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shipment line % not found', p_shipment_line_id;
  END IF;
  IF v_shipment.status <> 'picking' THEN
    RAISE EXCEPTION 'shipment % is not in a pickable state (status=%)', v_shipment.id, v_shipment.status;
  END IF;

  v_outstanding := v_line.quantity_requested - v_line.quantity_picked - v_line.quantity_exception;
  IF p_quantity > v_outstanding THEN
    RAISE EXCEPTION 'DAMAGE_EXCEEDS_OUTSTANDING: cannot report % damaged — only % outstanding on shipment line %', p_quantity, v_outstanding, p_shipment_line_id;
  END IF;

  SELECT COALESCE(SUM(unit_cost * quantity_remaining) / NULLIF(SUM(quantity_remaining), 0), 0) INTO v_unit_cost
    FROM cost_layers
   WHERE tenant_id = p_tenant_id AND warehouse_id = v_shipment.warehouse_id AND item_id = v_line.item_id
     AND COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(v_line.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
     AND quantity_remaining > 0;

  v_movement := fn_apply_stock_movement(
    p_tenant_id, v_shipment.warehouse_id, v_line.location_id, v_line.item_id, v_line.variant_id, NULL,
    'damage', 'out', p_quantity, v_unit_cost, 'shipment_line', p_shipment_line_id, p_actor_id,
    false, false
  );

  IF v_line.reservation_id IS NOT NULL THEN
    PERFORM fn_reduce_reservation(v_line.reservation_id, p_quantity, p_actor_id);
  END IF;

  UPDATE shipment_lines SET quantity_exception = quantity_exception + p_quantity WHERE id = p_shipment_line_id;

  INSERT INTO warehouse_exceptions (
    tenant_id, entity_type, entity_id, exception_type, affected_quantity, reason,
    notes, actor_id, status, resolution, resolved_at, resolved_by, stock_movement_id
  ) VALUES (
    p_tenant_id, 'shipment_line', p_shipment_line_id, 'damaged', p_quantity, p_reason,
    jsonb_build_object('shipment_id', v_shipment.id, 'unit_cost', v_unit_cost),
    p_actor_id, 'resolved', 'backordered', NOW(), p_actor_id, v_movement.id
  ) RETURNING * INTO v_exception;

  IF NOT EXISTS (
    SELECT 1 FROM shipment_lines
     WHERE shipment_id = v_shipment.id AND quantity_picked + quantity_exception < quantity_requested
  ) THEN
    UPDATE shipments SET status = 'picked', updated_at = NOW() WHERE id = v_shipment.id AND status = 'picking';
    INSERT INTO warehouse_work_status_history (tenant_id, entity_type, entity_id, old_status, new_status, actor_id, notes)
    VALUES (p_tenant_id, 'shipment', v_shipment.id, 'picking', 'picked', p_actor_id, 'settled with damage exception');
  END IF;

  SELECT pick_list_id INTO v_pick_list_id FROM pick_list_shipments WHERE shipment_id = v_shipment.id LIMIT 1;
  IF v_pick_list_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM shipment_lines sl2
    JOIN pick_list_shipments pls2 ON pls2.shipment_id = sl2.shipment_id
    WHERE pls2.pick_list_id = v_pick_list_id
      AND sl2.quantity_picked + sl2.quantity_exception < sl2.quantity_requested
  ) THEN
    UPDATE pick_lists SET status = 'completed', completed_at = NOW(), updated_at = NOW() WHERE id = v_pick_list_id AND status = 'in_progress';
    INSERT INTO warehouse_work_status_history (tenant_id, entity_type, entity_id, old_status, new_status, actor_id, notes)
    VALUES (p_tenant_id, 'pick_list', v_pick_list_id, 'in_progress', 'completed', p_actor_id, 'settled with damage exception');
  END IF;

  RETURN v_exception;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- fn_record_lost_item — a portion of a shipment line's outstanding
-- quantity is confirmed physically gone. Owner-approved treatment (see
-- decision 1 above): a real, immediate write-off through the existing
-- stock-movement engine — quantity_on_hand decreases for real, with full
-- cost-layer consumption, exactly like a sale. Never touches stock_levels
-- directly; fn_apply_stock_movement is the only writer.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_record_lost_item(
  p_shipment_line_id UUID,
  p_tenant_id        UUID,
  p_quantity         NUMERIC,
  p_reason           TEXT,
  p_actor_id         UUID
) RETURNS warehouse_exceptions AS $$
DECLARE
  v_line        shipment_lines;
  v_shipment    shipments;
  v_outstanding NUMERIC;
  v_unit_cost   NUMERIC;
  v_movement    stock_movements;
  v_exception   warehouse_exceptions;
  v_pick_list_id UUID;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'a reason is required';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'quantity must be positive, got %', p_quantity;
  END IF;

  SELECT * INTO v_line FROM shipment_lines WHERE id = p_shipment_line_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shipment line % not found', p_shipment_line_id;
  END IF;
  SELECT * INTO v_shipment FROM shipments WHERE id = v_line.shipment_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shipment line % not found', p_shipment_line_id;
  END IF;
  IF v_shipment.status <> 'picking' THEN
    RAISE EXCEPTION 'shipment % is not in a pickable state (status=%)', v_shipment.id, v_shipment.status;
  END IF;

  v_outstanding := v_line.quantity_requested - v_line.quantity_picked - v_line.quantity_exception;
  IF p_quantity > v_outstanding THEN
    RAISE EXCEPTION 'LOST_EXCEEDS_OUTSTANDING: cannot report % lost — only % outstanding on shipment line %', p_quantity, v_outstanding, p_shipment_line_id;
  END IF;

  -- Real FIFO cost-layer consumption — the same mechanism a real sale
  -- uses (fn_consume_cost_layers, migration 019) — this IS the write-off
  -- basis, not a read-only display figure the way damage's is.
  v_unit_cost := fn_consume_cost_layers(p_tenant_id, v_shipment.warehouse_id, v_line.item_id, v_line.variant_id, p_quantity);

  -- 'lost' + direction 'out' falls through to fn_apply_stock_movement's
  -- generic outbound branch (it is deliberately not in the damage/expiry/
  -- quality_hold reclassify-list) — a real quantity_on_hand decrement,
  -- full ledger row, before/after snapshot. allow_negative=false: a lost
  -- report can never claim more than is genuinely on hand and available
  -- (mirrors every other real outbound movement's guarantee).
  v_movement := fn_apply_stock_movement(
    p_tenant_id, v_shipment.warehouse_id, v_line.location_id, v_line.item_id, v_line.variant_id, NULL,
    'lost', 'out', p_quantity, v_unit_cost, 'shipment_line', p_shipment_line_id, p_actor_id,
    false, false
  );

  IF v_line.reservation_id IS NOT NULL THEN
    PERFORM fn_reduce_reservation(v_line.reservation_id, p_quantity, p_actor_id);
  END IF;

  UPDATE shipment_lines SET quantity_exception = quantity_exception + p_quantity WHERE id = p_shipment_line_id;

  INSERT INTO warehouse_exceptions (
    tenant_id, entity_type, entity_id, exception_type, affected_quantity, reason,
    notes, actor_id, status, resolution, resolved_at, resolved_by, stock_movement_id
  ) VALUES (
    p_tenant_id, 'shipment_line', p_shipment_line_id, 'lost', p_quantity, p_reason,
    jsonb_build_object('shipment_id', v_shipment.id, 'unit_cost', v_unit_cost, 'write_off', true),
    p_actor_id, 'resolved', 'written_off', NOW(), p_actor_id, v_movement.id
  ) RETURNING * INTO v_exception;

  IF NOT EXISTS (
    SELECT 1 FROM shipment_lines
     WHERE shipment_id = v_shipment.id AND quantity_picked + quantity_exception < quantity_requested
  ) THEN
    UPDATE shipments SET status = 'picked', updated_at = NOW() WHERE id = v_shipment.id AND status = 'picking';
    INSERT INTO warehouse_work_status_history (tenant_id, entity_type, entity_id, old_status, new_status, actor_id, notes)
    VALUES (p_tenant_id, 'shipment', v_shipment.id, 'picking', 'picked', p_actor_id, 'settled with lost-item write-off');
  END IF;

  SELECT pick_list_id INTO v_pick_list_id FROM pick_list_shipments WHERE shipment_id = v_shipment.id LIMIT 1;
  IF v_pick_list_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM shipment_lines sl2
    JOIN pick_list_shipments pls2 ON pls2.shipment_id = sl2.shipment_id
    WHERE pls2.pick_list_id = v_pick_list_id
      AND sl2.quantity_picked + sl2.quantity_exception < sl2.quantity_requested
  ) THEN
    UPDATE pick_lists SET status = 'completed', completed_at = NOW(), updated_at = NOW() WHERE id = v_pick_list_id AND status = 'in_progress';
    INSERT INTO warehouse_work_status_history (tenant_id, entity_type, entity_id, old_status, new_status, actor_id, notes)
    VALUES (p_tenant_id, 'pick_list', v_pick_list_id, 'in_progress', 'completed', p_actor_id, 'settled with lost-item write-off');
  END IF;

  RETURN v_exception;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- fn_cancel_shipment — reconciled to fn_cancel_pick_list/fn_cancel_wave's
-- reason/actor/history contract (previously had neither), and made
-- genuinely idempotent (repeat cancellation of an already-cancelled
-- shipment is a no-op, not a re-run of reservation release).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_cancel_shipment(
  p_shipment_id UUID,
  p_tenant_id   UUID,
  p_reason      TEXT,
  p_actor_id    UUID
) RETURNS shipments AS $$
DECLARE
  v_shipment       shipments;
  v_old_status     TEXT;
  v_reservation_id UUID;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'a cancellation reason is required';
  END IF;

  SELECT * INTO v_shipment FROM shipments WHERE id = p_shipment_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shipment % not found', p_shipment_id;
  END IF;

  IF v_shipment.status = 'cancelled' THEN
    RETURN v_shipment;
  END IF;
  IF v_shipment.status = 'shipped' THEN
    RAISE EXCEPTION 'shipment % has already shipped and cannot be cancelled', p_shipment_id;
  END IF;
  v_old_status := v_shipment.status;

  FOR v_reservation_id IN
    SELECT DISTINCT reservation_id FROM shipment_lines WHERE shipment_id = p_shipment_id AND reservation_id IS NOT NULL
  LOOP
    PERFORM fn_release_reservation(v_reservation_id, 'released');
  END LOOP;

  UPDATE shipments
     SET status = 'cancelled', cancellation_reason = p_reason, claimed_by_wave_id = NULL, claimed_at = NULL, updated_at = NOW()
   WHERE id = p_shipment_id
   RETURNING * INTO v_shipment;

  INSERT INTO warehouse_work_status_history (tenant_id, entity_type, entity_id, old_status, new_status, actor_id, notes)
  VALUES (p_tenant_id, 'shipment', p_shipment_id, v_old_status, 'cancelled', p_actor_id, p_reason);

  INSERT INTO warehouse_exceptions (
    tenant_id, entity_type, entity_id, exception_type, affected_quantity, reason,
    notes, actor_id, status, resolution, resolved_at, resolved_by
  ) VALUES (
    p_tenant_id, 'shipment', p_shipment_id, 'cancelled', NULL, p_reason,
    jsonb_build_object('old_status', v_old_status),
    p_actor_id, 'resolved', 'cancelled', NOW(), p_actor_id
  );

  RETURN v_shipment;
END;
$$ LANGUAGE plpgsql;
