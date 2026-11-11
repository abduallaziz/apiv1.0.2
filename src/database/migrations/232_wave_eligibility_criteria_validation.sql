-- 232. Fixes confirmed defects found during 7-5's 100% completeness
-- verification: fn_evaluate_wave_eligibility silently ignored unknown
-- criteria keys and malformed values for known keys, instead of treating
-- either as a hard error. Both are genuine "can silently produce
-- incorrect eligibility" defects, not business-policy questions:
--   * A criteria object with a typo'd or not-yet-implemented key (e.g.
--     someone writes "priority_minimum" instead of "priority_min", or
--     invents a key this engine doesn't understand yet) was previously
--     just skipped — the wave planner would believe a filter was applied
--     when it silently never ran, and every shipment would pass that
--     "criterion" unconditionally.
--   * priority_min: 'bogus' produced v_min_rank = NULL (the CASE
--     expression's implicit NULL on no match), which silently disabled
--     the priority filter entirely rather than failing loudly.
--   * The boolean-ish keys (require_inventory_ready, require_
--     replenishment_ready, capacity_ok, labor_available, dock_ready,
--     customer_service_level_ok) only ever checked "= 'true'" or
--     "= 'false'" — any other value (e.g. 'yes', '1', a typo) silently
--     fell through as neither true nor false, which for the *_ok/
--     available/ready keys meant silently NOT gating (treated as if
--     absent) rather than raising on the malformed input.
--
-- Fixed by validating the entire criteria object up front — unknown
-- keys and malformed values both raise before the wave is even moved out
-- of 'planning', so a bad criteria object can never produce a
-- partially-evaluated or silently-under-filtered wave.

CREATE OR REPLACE FUNCTION fn_evaluate_wave_eligibility(
  p_wave_id   UUID,
  p_tenant_id UUID,
  p_actor_id  UUID
) RETURNS SETOF wave_shipments AS $$
DECLARE
  v_wave              waves;
  v_shipment          RECORD;
  v_eligible          BOOLEAN;
  v_reasons           JSONB;
  v_external_blocked  BOOLEAN := false;
  v_priority_rank     INTEGER;
  v_min_rank          INTEGER;
  v_ws                wave_shipments;
  v_key               TEXT;
  v_bool_key          TEXT;
BEGIN
  SELECT * INTO v_wave FROM waves WHERE id = p_wave_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'wave % not found', p_wave_id;
  END IF;
  IF v_wave.status <> 'planning' THEN
    RAISE EXCEPTION 'wave % cannot be evaluated (status=%) — evaluation only runs from planning', p_wave_id, v_wave.status;
  END IF;

  -- Reject unknown criteria keys outright — this is the complete,
  -- authoritative list of everything this engine understands. Adding a
  -- new criterion means adding it here AND to the evaluation logic below
  -- in the same migration, never silently accepting an unrecognized key.
  FOR v_key IN SELECT jsonb_object_keys(v_wave.criteria) LOOP
    IF v_key NOT IN (
      'priority_min', 'zone_ids', 'route', 'carrier', 'order_type',
      'cutoff_before', 'release_after', 'release_before',
      'require_inventory_ready', 'require_replenishment_ready',
      'capacity_ok', 'labor_available', 'dock_ready', 'customer_service_level_ok'
    ) THEN
      RAISE EXCEPTION 'UNKNOWN_CRITERIA_KEY: "%" is not a recognized wave eligibility criterion', v_key;
    END IF;
  END LOOP;

  IF v_wave.criteria ? 'priority_min'
     AND v_wave.criteria->>'priority_min' NOT IN ('low', 'medium', 'high', 'urgent') THEN
    RAISE EXCEPTION 'INVALID_CRITERIA_VALUE: priority_min must be one of low/medium/high/urgent, got "%"', v_wave.criteria->>'priority_min';
  END IF;

  FOREACH v_bool_key IN ARRAY ARRAY['require_inventory_ready', 'require_replenishment_ready', 'capacity_ok', 'labor_available', 'dock_ready', 'customer_service_level_ok'] LOOP
    IF v_wave.criteria ? v_bool_key AND v_wave.criteria->>v_bool_key NOT IN ('true', 'false') THEN
      RAISE EXCEPTION 'INVALID_CRITERIA_VALUE: % must be exactly "true" or "false", got "%"', v_bool_key, v_wave.criteria->>v_bool_key;
    END IF;
  END LOOP;

  -- Release window: a wave-level gate against NOW(), not a per-shipment filter.
  -- A malformed timestamp here raises naturally (Postgres cast error) before
  -- any state change, same "fail loudly, never silently" standard.
  IF v_wave.criteria ? 'release_after' AND NOW() < (v_wave.criteria->>'release_after')::timestamptz THEN
    RAISE EXCEPTION 'WAVE_NOT_YET_IN_RELEASE_WINDOW: wave % cannot be evaluated before %', p_wave_id, v_wave.criteria->>'release_after';
  END IF;
  IF v_wave.criteria ? 'release_before' AND NOW() > (v_wave.criteria->>'release_before')::timestamptz THEN
    RAISE EXCEPTION 'WAVE_PAST_RELEASE_WINDOW: wave % release window closed at %', p_wave_id, v_wave.criteria->>'release_before';
  END IF;

  UPDATE waves SET status = 'evaluating', evaluated_at = NOW(), updated_at = NOW() WHERE id = p_wave_id;
  INSERT INTO warehouse_work_status_history (tenant_id, entity_type, entity_id, old_status, new_status, actor_id)
  VALUES (p_tenant_id, 'wave', p_wave_id, 'planning', 'evaluating', p_actor_id);

  -- Opaque external signals: customer_service_level_ok, capacity_ok,
  -- labor_available, dock_ready. Sefay has NO native source of truth for
  -- any of these today (confirmed: no tier/segment field anywhere on
  -- customers; no Workforce/Scheduling/Dock domain exists at all) — this
  -- function never queries for or fabricates a value for any of them.
  -- They are respected exactly as given by the caller: a future CRM
  -- domain (for customer_service_level_ok) or Workforce/Dock domain
  -- (for the other three) resolves the real signal and writes an
  -- already-decided boolean into waves.criteria BEFORE evaluate is
  -- called — this function only ever reads that pre-resolved value, the
  -- same way it reads any other criteria key. If the key is absent,
  -- nothing is gated on it (identical to every other optional criterion
  -- in this engine); if present, it must be exactly 'true'/'false'
  -- (validated above) — never silently skipped for being malformed.
  -- Because these are the same JSONB-key mechanism as every native
  -- criterion, a future domain arriving does not require redesigning
  -- this engine — it requires exactly the same two-line addition every
  -- native criterion below already demonstrates (validate the key,
  -- evaluate it in the loop), the identical pattern used for
  -- priority/route/cutoff in migration 231.
  IF (v_wave.criteria->>'capacity_ok') = 'false'
     OR (v_wave.criteria->>'labor_available') = 'false'
     OR (v_wave.criteria->>'dock_ready') = 'false'
     OR (v_wave.criteria->>'customer_service_level_ok') = 'false' THEN
    v_external_blocked := true;
  END IF;

  IF v_wave.criteria ? 'priority_min' THEN
    v_min_rank := CASE v_wave.criteria->>'priority_min'
      WHEN 'low' THEN 1 WHEN 'medium' THEN 2 WHEN 'high' THEN 3 WHEN 'urgent' THEN 4 END;
  END IF;

  FOR v_shipment IN
    SELECT * FROM shipments WHERE tenant_id = p_tenant_id AND warehouse_id = v_wave.warehouse_id AND status = 'pending'
  LOOP
    v_eligible := true;
    v_reasons := '{}'::jsonb;

    IF v_external_blocked THEN
      v_eligible := false;
      v_reasons := v_reasons || jsonb_build_object('external_signal_blocked', true);
    END IF;

    IF v_min_rank IS NOT NULL THEN
      v_priority_rank := CASE v_shipment.priority
        WHEN 'low' THEN 1 WHEN 'medium' THEN 2 WHEN 'high' THEN 3 WHEN 'urgent' THEN 4 END;
      v_reasons := v_reasons || jsonb_build_object('priority', v_shipment.priority, 'priority_min_required', v_wave.criteria->>'priority_min');
      IF v_priority_rank < v_min_rank THEN v_eligible := false; END IF;
    END IF;

    IF v_wave.criteria ? 'zone_ids' THEN
      v_reasons := v_reasons || jsonb_build_object('zone_ids_required', v_wave.criteria->'zone_ids');
      IF NOT EXISTS (
        SELECT 1 FROM shipment_lines sl, jsonb_array_elements_text(v_wave.criteria->'zone_ids') AS z(zone_id)
        WHERE sl.shipment_id = v_shipment.id AND fn_location_is_in_zone(sl.location_id, z.zone_id::uuid)
      ) THEN
        v_eligible := false;
      END IF;
    END IF;

    IF v_wave.criteria ? 'route' THEN
      v_reasons := v_reasons || jsonb_build_object('route', v_shipment.route, 'route_required', v_wave.criteria->>'route');
      IF v_shipment.route IS DISTINCT FROM (v_wave.criteria->>'route') THEN v_eligible := false; END IF;
    END IF;

    IF v_wave.criteria ? 'carrier' THEN
      v_reasons := v_reasons || jsonb_build_object('carrier', v_shipment.carrier, 'carrier_required', v_wave.criteria->>'carrier');
      IF v_shipment.carrier IS DISTINCT FROM (v_wave.criteria->>'carrier') THEN v_eligible := false; END IF;
    END IF;

    IF v_wave.criteria ? 'order_type' THEN
      v_reasons := v_reasons || jsonb_build_object('order_type', v_shipment.reference_type, 'order_type_required', v_wave.criteria->>'order_type');
      IF v_shipment.reference_type IS DISTINCT FROM (v_wave.criteria->>'order_type') THEN v_eligible := false; END IF;
    END IF;

    IF v_wave.criteria ? 'cutoff_before' THEN
      v_reasons := v_reasons || jsonb_build_object('cutoff_at', v_shipment.cutoff_at, 'cutoff_before_required', v_wave.criteria->>'cutoff_before');
      IF v_shipment.cutoff_at IS NULL OR v_shipment.cutoff_at > (v_wave.criteria->>'cutoff_before')::timestamptz THEN v_eligible := false; END IF;
    END IF;

    IF (v_wave.criteria->>'require_inventory_ready') = 'true' THEN
      IF EXISTS (
        SELECT 1 FROM shipment_lines sl
        LEFT JOIN v_stock_balance vb
          ON vb.tenant_id = p_tenant_id AND vb.warehouse_id = v_wave.warehouse_id AND vb.item_id = sl.item_id
         AND COALESCE(vb.variant_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(sl.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
        WHERE sl.shipment_id = v_shipment.id
          AND COALESCE(vb.quantity_available, 0) < sl.quantity_requested
      ) THEN
        v_eligible := false;
        v_reasons := v_reasons || jsonb_build_object('inventory_ready', false);
      ELSE
        v_reasons := v_reasons || jsonb_build_object('inventory_ready', true);
      END IF;
    END IF;

    IF (v_wave.criteria->>'require_replenishment_ready') = 'true' THEN
      IF EXISTS (
        SELECT 1 FROM shipment_lines sl
        JOIN inventory_reorder_points rp
          ON rp.tenant_id = p_tenant_id AND rp.warehouse_id = v_wave.warehouse_id AND rp.item_id = sl.item_id
         AND COALESCE(rp.variant_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(sl.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
         AND rp.is_active = true
        JOIN v_stock_balance vb
          ON vb.tenant_id = p_tenant_id AND vb.warehouse_id = v_wave.warehouse_id AND vb.item_id = sl.item_id
         AND COALESCE(vb.variant_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(sl.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
        WHERE sl.shipment_id = v_shipment.id AND vb.quantity_on_hand < rp.min_quantity
      ) THEN
        v_eligible := false;
        v_reasons := v_reasons || jsonb_build_object('replenishment_ready', false);
      ELSE
        v_reasons := v_reasons || jsonb_build_object('replenishment_ready', true);
      END IF;
    END IF;

    INSERT INTO wave_shipments (tenant_id, wave_id, shipment_id, included_reason, excluded_reason)
    VALUES (
      p_tenant_id, p_wave_id, v_shipment.id,
      CASE WHEN v_eligible THEN v_reasons ELSE NULL END,
      CASE WHEN NOT v_eligible THEN v_reasons ELSE NULL END
    )
    ON CONFLICT (wave_id, shipment_id) DO UPDATE
      SET included_reason = EXCLUDED.included_reason,
          excluded_reason = EXCLUDED.excluded_reason
    RETURNING * INTO v_ws;

    RETURN NEXT v_ws;
  END LOOP;

  UPDATE waves SET status = 'reviewing', updated_at = NOW() WHERE id = p_wave_id;
  INSERT INTO warehouse_work_status_history (tenant_id, entity_type, entity_id, old_status, new_status, actor_id)
  VALUES (p_tenant_id, 'wave', p_wave_id, 'evaluating', 'reviewing', p_actor_id);

  RETURN;
END;
$$ LANGUAGE plpgsql;
