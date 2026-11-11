-- 248. Inventory #7 / F7 Gap Closure (Owner-approved "Approved – Proceed
-- with Implementation") — real Wave lifecycle transitions:
--   released -> picking     (synchronous, inside fn_release_wave)
--   picking  -> completed   (trigger-driven, inside fn_confirm_pick's
--                             transaction, and fn_cancel_pick_list's)
--
-- Architectural basis (per the approved design, confirmed against the
-- real existing code before writing this):
--   - fn_release_wave already creates the wave's pick_lists row directly
--     at status='in_progress' in the same transaction that sets
--     waves.status='released' — the wave is therefore already, in fact,
--     "in picking" the instant release succeeds. This migration makes
--     that fact observable on waves.status itself instead of leaving it
--     implicit.
--   - fn_confirm_pick already atomically sets pick_lists.status=
--     'completed' the moment every pick_list_lines row for that pick
--     list is fully picked (migration 225) — real, existing, correct.
--   - fn_cancel_pick_list can also move a pick_list to 'cancelled'
--     (migration 237) — a cancelled pick list must not block wave
--     completion (owner-specified rule: completed + cancelled = wave
--     completed), so the completion check must also run when a pick
--     list is cancelled, not only when one completes.
--
-- Both transitions are pure database-level and transactional: no
-- NestJS service code implements the transition logic; the frontend
-- only ever reads waves.status via GET /waves/:id (already existing),
-- never writes it. No manual "mark wave completed" action exists or is
-- added.

-- =============================================================================
-- released -> picking (synchronous, same transaction as fn_release_wave)
-- =============================================================================
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
  SELECT * INTO v_wave FROM waves WHERE id = p_wave_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'wave % not found', p_wave_id;
  END IF;

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

  SELECT array_agg(shipment_id) INTO v_failed_ids
    FROM wave_shipments
   WHERE wave_id = p_wave_id AND tenant_id = p_tenant_id AND included_reason IS NOT NULL
     AND shipment_id <> ALL(COALESCE(v_claimed_ids, ARRAY[]::uuid[]));

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

  -- Nothing claimable: unchanged from 238 — commit exclusion bookkeeping,
  -- leave the wave in 'reviewing', no release happened at all, so no
  -- released/picking transition or history is written on this path.
  IF v_claimed_ids IS NULL OR array_length(v_claimed_ids, 1) IS NULL THEN
    RETURN;
  END IF;

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

  -- released -> picking: real operational picking work now exists (the
  -- pick list created above is already 'in_progress'), so the wave's
  -- persisted status is advanced to reflect that immediately, in the
  -- same transaction — never a separately-observable "released but not
  -- yet picking" state, since that gap never actually exists in reality.
  UPDATE waves SET status = 'picking', updated_at = NOW() WHERE id = p_wave_id;
  INSERT INTO warehouse_work_status_history (tenant_id, entity_type, entity_id, old_status, new_status, actor_id)
  VALUES (p_tenant_id, 'wave', p_wave_id, 'released', 'picking', p_actor_id);

  RETURN NEXT v_pick_list;
  RETURN;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- picking -> completed (trigger-driven, fires inside whatever transaction
-- moved a pick list to 'completed' or 'cancelled' — fn_confirm_pick or
-- fn_cancel_pick_list — never a separate/async job, never polling).
-- =============================================================================
CREATE OR REPLACE FUNCTION fn_check_wave_completion() RETURNS TRIGGER AS $$
DECLARE
  v_wave        waves;
  v_unfinished  INTEGER;
BEGIN
  IF NEW.wave_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Idempotency / no-regression guard: only a wave genuinely in
  -- 'picking' can be auto-completed here. A wave that's already
  -- 'completed' (duplicate completion signal from a second pick list
  -- finishing, or the same pick list's row being touched again) or in
  -- any other state is left untouched — this trigger only ever advances
  -- 'picking' -> 'completed', never anything else, and never runs twice
  -- for the same wave since the second time v_wave.status is no longer
  -- 'picking'.
  SELECT * INTO v_wave FROM waves WHERE id = NEW.wave_id AND tenant_id = NEW.tenant_id FOR UPDATE;
  IF NOT FOUND OR v_wave.status <> 'picking' THEN
    RETURN NEW;
  END IF;

  -- Owner-specified completion rule: a cancelled pick list does not
  -- block completion (completed + cancelled = wave completed). Only
  -- pick lists still genuinely open/in_progress count as unfinished
  -- work. Scoped by tenant_id + wave_id, using the existing
  -- idx_pick_lists_wave index — never a global scan.
  SELECT COUNT(*) INTO v_unfinished
    FROM pick_lists
   WHERE wave_id = NEW.wave_id AND tenant_id = NEW.tenant_id
     AND status NOT IN ('completed', 'cancelled');

  IF v_unfinished = 0 THEN
    UPDATE waves SET status = 'completed', completed_at = NOW(), updated_at = NOW()
     WHERE id = NEW.wave_id AND tenant_id = NEW.tenant_id;

    -- System-detected fact, not a single human action (the last pick or
    -- cancellation that happened to close out the wave could have been
    -- performed by any one of several actors across multiple pick
    -- lists) — actor_id is NULL here, matching this codebase's existing
    -- "System" convention for actor-less history rows (see
    -- pickListDetail.history.unknownActor in the frontend i18n, already
    -- built for exactly this case).
    INSERT INTO warehouse_work_status_history (tenant_id, entity_type, entity_id, old_status, new_status, actor_id, notes)
    VALUES (NEW.tenant_id, 'wave', NEW.wave_id, 'picking', 'completed', NULL, 'all operational pick lists complete or cancelled');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_wave_completion ON pick_lists;
CREATE TRIGGER trg_check_wave_completion
  AFTER UPDATE OF status ON pick_lists
  FOR EACH ROW
  WHEN (NEW.wave_id IS NOT NULL AND NEW.status IN ('completed', 'cancelled') AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION fn_check_wave_completion();
