-- 237. Inventory #7 / Migration Item 7-6 (Owner-approved) — Wave Claim +
-- Release.
--
-- Builds on 7-1 (warehouse_work_status_history/audit_logs), 7-2
-- (fn_create_pick_list), 7-3 (fn_location_is_in_zone / zone-descendant
-- resolution), 7-4 (waves/wave_shipments schema), 7-5
-- (fn_evaluate_wave_eligibility, which leaves a wave in status=
-- 'reviewing' with wave_shipments rows carrying exactly one of
-- included_reason/excluded_reason).
--
-- ARCHITECTURE DECISIONS (documented, not silently assumed):
--
-- 1. Claim mechanism: shipments.claimed_by_wave_id / claimed_at, per the
--    approved architecture (section 2 of the 7-6 spec), claimed via a
--    single atomic `UPDATE ... WHERE status='pending' AND
--    claimed_by_wave_id IS NULL ... RETURNING id` — never a
--    SELECT-then-UPDATE. Postgres serializes concurrent UPDATEs
--    targeting the same row (the second waits for the first's row lock,
--    then re-evaluates its WHERE clause against the now-committed row
--    and naturally excludes it), which is what gives "only one wave can
--    ever claim a given shipment" without any application-level locking.
--
-- 2. Claim is not a separately durable wave status. The approved status
--    enum (planning/evaluating/reviewing/released/picking/completed/
--    cancelled) has no "claimed" state, and section 4 itself lists
--    "claim eligible shipments atomically" as step 4 of the Release
--    operation. Claim is therefore implemented as an atomic sub-step
--    inside fn_release_wave's single transaction, not a separate public
--    RPC/endpoint — there is no legitimate state for "claimed but not
--    released" to persist in.
--
-- 3. Wave + Zone interaction: pick_lists already has
--    chk_pick_list_zone_requires_location (migration 116), which
--    requires zone_location_id IS NULL for every non-'zone' strategy.
--    This is existing, already-approved schema I must not weaken. A
--    released wave therefore produces exactly ONE pick_lists row
--    (strategy='wave', wave_id=<wave>, zone_location_id=NULL) covering
--    every claimed shipment's lines, exactly like the existing
--    'single'/'batch' strategies already span multiple locations via
--    multiple pick_list_lines rows (each carrying its own location_id).
--    No zone information is lost — it lives on pick_list_lines.location_id,
--    same as every other non-'zone' strategy today. This does not
--    contradict "respect Zones/multi-zone splitting" (7-3): 7-3's
--    zone-splitting behavior is a distinct strategy ('zone') for a
--    distinct entry point (fn_create_zone_pick_lists_for_shipments,
--    invoked directly with shipment ids), and remains fully available
--    and untouched for non-wave picking.
--
-- 4. Zero successfully-claimed shipments (either because the wave had
--    zero included shipments after evaluation, or every included
--    shipment lost eligibility — was claimed elsewhere, or left
--    'pending' — between evaluation and release) aborts the entire
--    release with WAVE_NO_ELIGIBLE_SHIPMENTS, rolling back any partial
--    claim already made in this same call. A "released" wave with zero
--    pick lists would be a materially broken state, not a legitimate
--    partial release — nothing has been defined that permits it, so per
--    "do not invent behavior where Sefay has not defined it" this fails
--    closed rather than silently succeeding.
--
-- 5. fn_cancel_wave is added as required lifecycle infrastructure: the
--    approved state machine explicitly requires "cancellation available
--    only in valid pre-picking states" (section 7) and section 14
--    requires testing both "cancellation before release" and "release
--    after cancellation" — neither is testable without a real cancel
--    path, and none existed before this migration.
--
-- 6. fn_cancel_pick_list (225/226) is extended (CREATE OR REPLACE, not
--    edited in place) to also clear claimed_by_wave_id/claimed_at when
--    it reverts a shipment from 'picking' back to 'pending'. This is a
--    genuine discovered dependency, not scope creep: without it, a
--    cancelled wave pick list would permanently strand its shipments —
--    claimed_by_wave_id would stay set forever, and fn_release_wave's
--    claim guard (claimed_by_wave_id IS NULL) would make them
--    unclaimable by any future wave.

ALTER TABLE shipments
  ADD COLUMN claimed_by_wave_id UUID REFERENCES waves(id) ON DELETE SET NULL,
  ADD COLUMN claimed_at TIMESTAMPTZ;

ALTER TABLE shipments ADD CONSTRAINT chk_shipment_claimed_at_matches_claim
  CHECK ((claimed_by_wave_id IS NULL) = (claimed_at IS NULL));

CREATE INDEX idx_shipments_claimed_by_wave ON shipments(tenant_id, claimed_by_wave_id) WHERE claimed_by_wave_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- fn_release_wave — the single, transactional Claim+Release operation.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_release_wave(
  p_wave_id   UUID,
  p_tenant_id UUID,
  p_actor_id  UUID,
  p_priority  TEXT DEFAULT 'medium'
) RETURNS SETOF pick_lists AS $$
DECLARE
  v_wave          waves;
  v_claimed_ids   UUID[];
  v_failed_ids    UUID[];
  v_shipment_id   UUID;
  v_current       shipments;
  v_pick_list     pick_lists;
  v_line          RECORD;
  v_pll           pick_list_lines;
  v_reservation   stock_reservations;
BEGIN
  -- Row lock on the wave itself is the concurrency primitive for
  -- "two simultaneous release requests for the same wave": the second
  -- caller blocks here until the first's transaction commits or rolls
  -- back, then re-reads the (now-updated) row and takes the idempotent
  -- no-op path below instead of re-running the release logic.
  SELECT * INTO v_wave FROM waves WHERE id = p_wave_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'wave % not found', p_wave_id;
  END IF;

  -- Idempotency: a wave already past 'reviewing' has already been
  -- released (by this call or an earlier one) — return its existing
  -- pick list(s) rather than duplicating any work. No writes occur on
  -- this path.
  IF v_wave.status IN ('released', 'picking', 'completed') THEN
    RETURN QUERY SELECT * FROM pick_lists WHERE wave_id = p_wave_id AND tenant_id = p_tenant_id;
    RETURN;
  END IF;

  IF v_wave.status = 'cancelled' THEN
    RAISE EXCEPTION 'WAVE_CANCELLED: wave % has been cancelled and cannot be released', p_wave_id;
  END IF;

  IF v_wave.status <> 'reviewing' THEN
    RAISE EXCEPTION 'WAVE_NOT_READY: wave % cannot be released (status=%) — release requires a completed evaluation (status=reviewing)', p_wave_id, v_wave.status;
  END IF;

  -- Atomic claim: single UPDATE...WHERE...RETURNING, never
  -- SELECT-then-UPDATE. Only shipments this wave evaluated as included,
  -- still tenant-scoped, still 'pending', and not already claimed by any
  -- other wave are claimed. Two different waves racing for the same
  -- shipment: Postgres's row-level lock during the UPDATE serializes
  -- them — whichever commits first wins; the second's WHERE clause
  -- (claimed_by_wave_id IS NULL) then excludes that row automatically,
  -- no duplicate ownership possible.
  WITH claimed AS (
    UPDATE shipments
       SET claimed_by_wave_id = p_wave_id, claimed_at = NOW(), status = 'picking', updated_at = NOW()
     WHERE tenant_id = p_tenant_id
       AND status = 'pending'
       AND claimed_by_wave_id IS NULL
       AND id IN (
         SELECT shipment_id FROM wave_shipments
          WHERE wave_id = p_wave_id AND tenant_id = p_tenant_id AND included_reason IS NOT NULL
       )
     RETURNING id
  )
  SELECT array_agg(id) INTO v_claimed_ids FROM claimed;

  IF v_claimed_ids IS NULL OR array_length(v_claimed_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'WAVE_NO_ELIGIBLE_SHIPMENTS: wave % has no shipments that could be claimed (none were eligible, or every eligible shipment is no longer available)', p_wave_id;
  END IF;

  -- Shipments this wave included at evaluation time but that failed to
  -- claim (became unavailable, or lost the race to another wave) between
  -- evaluation and release: preserve full auditability by flipping them
  -- to excluded with the concrete reason, never silently dropped.
  SELECT array_agg(shipment_id) INTO v_failed_ids
    FROM wave_shipments
   WHERE wave_id = p_wave_id AND tenant_id = p_tenant_id AND included_reason IS NOT NULL
     AND shipment_id <> ALL(v_claimed_ids);

  IF v_failed_ids IS NOT NULL THEN
    FOREACH v_shipment_id IN ARRAY v_failed_ids LOOP
      SELECT * INTO v_current FROM shipments WHERE id = v_shipment_id;
      UPDATE wave_shipments
         SET included_reason = NULL,
             excluded_reason = jsonb_build_object(
               'reason', 'claim_failed_at_release',
               'shipment_status_at_release', v_current.status,
               'claimed_by_other_wave_id', v_current.claimed_by_wave_id
             )
       WHERE wave_id = p_wave_id AND tenant_id = p_tenant_id AND shipment_id = v_shipment_id;
    END LOOP;
  END IF;

  -- Exactly one pick list per released wave — see architecture note 3
  -- above (chk_pick_list_zone_requires_location forbids a zone pin on
  -- any non-'zone' strategy; per-line zone/location detail is preserved
  -- on pick_list_lines.location_id instead, same as 'single'/'batch').
  INSERT INTO pick_lists (tenant_id, warehouse_id, strategy, wave_id, zone_location_id, priority, status, created_by, started_at)
  VALUES (p_tenant_id, v_wave.warehouse_id, 'wave', p_wave_id, NULL, COALESCE(p_priority, 'medium'), 'in_progress', p_actor_id, NOW())
  RETURNING * INTO v_pick_list;

  INSERT INTO pick_list_shipments (tenant_id, pick_list_id, shipment_id)
  SELECT p_tenant_id, v_pick_list.id, unnest(v_claimed_ids);

  FOR v_line IN
    SELECT sl.item_id, sl.variant_id, sl.location_id, SUM(sl.quantity_requested) AS total_qty
    FROM shipment_lines sl
    WHERE sl.shipment_id = ANY(v_claimed_ids)
    GROUP BY sl.item_id, sl.variant_id, sl.location_id
  LOOP
    INSERT INTO pick_list_lines (tenant_id, pick_list_id, item_id, variant_id, location_id, quantity_to_pick)
    VALUES (p_tenant_id, v_pick_list.id, v_line.item_id, v_line.variant_id, v_line.location_id, v_line.total_qty)
    RETURNING * INTO v_pll;

    -- Reservation failure (e.g. insufficient stock) raises, which rolls
    -- back this entire function call — the claim above, the pick list,
    -- and every prior line/reservation already inserted in this same
    -- call — leaving the wave exactly as it was before release was
    -- attempted (still 'reviewing', shipments still unclaimed). No
    -- application-level compensation logic exists or is needed: this is
    -- a single plpgsql function body, which runs inside the caller's
    -- transaction with no autonomous sub-transaction, so ROLLBACK is
    -- true all-or-nothing atomicity, not simulated.
    v_reservation := fn_create_reservation(
      p_tenant_id, v_wave.warehouse_id, v_line.item_id, v_line.variant_id, NULL,
      v_line.total_qty, 'pick_list_line', v_pll.id, p_actor_id, NULL
    );

    UPDATE shipment_lines
       SET reservation_id = v_reservation.id
     WHERE shipment_id = ANY(v_claimed_ids)
       AND item_id = v_line.item_id
       AND COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(v_line.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
       AND COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(v_line.location_id, '00000000-0000-0000-0000-000000000000'::uuid);
  END LOOP;

  INSERT INTO warehouse_work_status_history (tenant_id, entity_type, entity_id, old_status, new_status, actor_id)
  VALUES (p_tenant_id, 'pick_list', v_pick_list.id, NULL, 'in_progress', p_actor_id);

  UPDATE waves SET status = 'released', released_at = NOW(), updated_at = NOW() WHERE id = p_wave_id;
  INSERT INTO warehouse_work_status_history (tenant_id, entity_type, entity_id, old_status, new_status, actor_id, notes)
  VALUES (
    p_tenant_id, 'wave', p_wave_id, 'reviewing', 'released', p_actor_id,
    format('claimed %s shipment(s), %s pick list', array_length(v_claimed_ids, 1), 1)
  );

  RETURN NEXT v_pick_list;
  RETURN;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- fn_cancel_wave — required lifecycle infrastructure (see note 5 above).
-- Mirrors fn_cancel_pick_list's shape (reason required, row-locked,
-- status-gated, history-recorded).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_cancel_wave(
  p_wave_id   UUID,
  p_tenant_id UUID,
  p_reason    TEXT,
  p_actor_id  UUID
) RETURNS waves AS $$
DECLARE
  v_wave      waves;
  v_old_status TEXT;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'a cancellation reason is required';
  END IF;

  SELECT * INTO v_wave FROM waves WHERE id = p_wave_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'wave % not found', p_wave_id;
  END IF;

  -- Pre-picking states only, per the approved state machine ("cancellation
  -- available only in valid pre-picking states"). A released/picking/
  -- completed wave already owns claimed shipments and pick lists —
  -- unwinding those is pick-list cancellation's job (fn_cancel_pick_list),
  -- not wave cancellation's.
  IF v_wave.status NOT IN ('planning', 'evaluating', 'reviewing') THEN
    RAISE EXCEPTION 'WAVE_CANNOT_CANCEL: wave % cannot be cancelled (status=%) — cancellation is only valid before release', p_wave_id, v_wave.status;
  END IF;
  v_old_status := v_wave.status;

  UPDATE waves
     SET status = 'cancelled', cancellation_reason = p_reason, cancelled_at = NOW(), updated_at = NOW()
   WHERE id = p_wave_id
   RETURNING * INTO v_wave;

  INSERT INTO warehouse_work_status_history (tenant_id, entity_type, entity_id, old_status, new_status, actor_id, notes)
  VALUES (p_tenant_id, 'wave', p_wave_id, v_old_status, 'cancelled', p_actor_id, p_reason);

  RETURN v_wave;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- fn_cancel_pick_list — extended to release the wave-claim marker
-- alongside the existing status revert, so a cancelled wave pick list's
-- shipments become claimable again instead of being permanently
-- stranded (see architecture note 6 above). Everything else in this
-- function is byte-identical to migration 226's version.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_cancel_pick_list(
  p_pick_list_id UUID, p_tenant_id UUID, p_reason TEXT, p_actor_id UUID
) RETURNS pick_lists AS $$
DECLARE
  v_pick_list pick_lists;
  v_old_status TEXT;
  v_reservation_id UUID;
  v_shipment_id UUID;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'a cancellation reason is required';
  END IF;

  SELECT * INTO v_pick_list FROM pick_lists WHERE id = p_pick_list_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'pick list % not found', p_pick_list_id; END IF;
  IF v_pick_list.status NOT IN ('open', 'in_progress') THEN
    RAISE EXCEPTION 'pick list % cannot be cancelled (status=%)', p_pick_list_id, v_pick_list.status;
  END IF;
  v_old_status := v_pick_list.status;

  FOR v_reservation_id IN
    SELECT DISTINCT sl.reservation_id
    FROM shipment_lines sl
    JOIN pick_list_shipments pls ON pls.shipment_id = sl.shipment_id
    WHERE pls.pick_list_id = p_pick_list_id AND sl.reservation_id IS NOT NULL
  LOOP
    PERFORM fn_release_reservation(v_reservation_id, 'released');
  END LOOP;

  FOR v_shipment_id IN
    SELECT shipment_id FROM pick_list_shipments WHERE pick_list_id = p_pick_list_id
  LOOP
    UPDATE shipments
       SET status = 'pending', updated_at = NOW(),
           claimed_by_wave_id = NULL, claimed_at = NULL
     WHERE id = v_shipment_id AND status = 'picking';
  END LOOP;

  UPDATE pick_lists
     SET status = 'cancelled', cancellation_reason = p_reason, updated_at = NOW()
   WHERE id = p_pick_list_id
   RETURNING * INTO v_pick_list;

  INSERT INTO warehouse_work_status_history (tenant_id, entity_type, entity_id, old_status, new_status, actor_id, notes)
  VALUES (p_tenant_id, 'pick_list', p_pick_list_id, v_old_status, 'cancelled', p_actor_id, p_reason);

  RETURN v_pick_list;
END;
$$ LANGUAGE plpgsql;
