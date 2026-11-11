-- 238. Fixes a confirmed defect in migration 237, found via this item's
-- own required concurrency test (7-6 §10 Test B — two waves racing for
-- the same shipment): when a wave's claim attempt succeeded for ZERO
-- shipments (either it had none included at evaluation time, or every
-- included shipment lost the claim race to another wave), the original
-- fn_release_wave raised WAVE_NO_ELIGIBLE_SHIPMENTS immediately after
-- computing v_claimed_ids — before ever reaching the wave_shipments
-- exclusion-reason bookkeeping below it. Since a RAISE EXCEPTION rolls
-- back the entire function's transaction, that bookkeeping (which would
-- have recorded exactly why the race was lost — claim_failed_at_release,
-- claimed_by_other_wave_id) was rolled back along with everything else,
-- silently leaving the losing wave_shipments row exactly as evaluation
-- left it — a genuine "do not invent behavior; keep the operation
-- consistent and auditable" violation (7-6 §3), confirmed live: the
-- test asserted the loser's wave_shipments.excluded_reason was set and
-- found included_reason still non-null instead.
--
-- Fixed by never raising for "nothing claimable" at all. The bookkeeping
-- update now always runs regardless of how many (zero or more)
-- shipments were claimed, and a zero-claim outcome simply returns an
-- empty SETOF pick_lists with the wave left untouched in 'reviewing' —
-- no pick list, no status transition, no history/audit entry for a
-- release that didn't happen — while the exclusion reasons for every
-- shipment that failed to claim are durably committed. This is still
-- atomic: nothing destructive is attempted on the zero-claim path, so
-- there is nothing that needs to roll back. The service layer
-- (WmsService.releaseWave) now inspects an empty result and raises a
-- clear WAVE_NO_ELIGIBLE_SHIPMENTS error to the caller itself, keeping
-- "fail loudly to the API caller" (§14) separate from "never discard
-- audit data" (§3) instead of conflating the two the way the SQL-level
-- exception did.

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

  -- Shipments this wave included at evaluation time but that failed to
  -- claim: recorded unconditionally, whether zero, some, or (below) all
  -- of this wave's candidates ended up in this set — never skipped, and
  -- never rolled back by a later RAISE, because there is no later RAISE
  -- on this path any more.
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

  -- Nothing claimable: commit the exclusion bookkeeping above (already
  -- done), leave the wave untouched in 'reviewing' (no pick list, no
  -- status transition, no release history/audit — nothing was actually
  -- released), and return zero rows. The caller decides whether an
  -- empty result is itself an error (WmsService.releaseWave does).
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

    -- A reservation failure here (e.g. insufficient stock) still rolls
    -- back the entire function call, including the claim and the
    -- wave_shipments bookkeeping above — that is correct: this failure
    -- happens strictly after the "nothing claimable" early return, so it
    -- only ever occurs when a real release was genuinely attempted and a
    -- genuine mid-release fault occurred, which must remain all-or-nothing.
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
