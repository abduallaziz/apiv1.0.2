-- 231. Inventory #7 / Migration Item 7-5 (Owner-approved) — Wave
-- Eligibility Evaluation.
--
-- Per your explicit directive: do NOT reduce this to a small fixed
-- subset. For every criterion in the approved list, the rule applied
-- here is: (1) inspect Sefay's actual existing data, (2) reuse it where
-- it exists, (3) add the field when it is genuinely WMS/Inventory's own
-- and missing, (4) treat it as an external, opaque, pass-through signal
-- when it belongs to a domain Sefay doesn't have yet (§5.4) — never
-- invent fake domain tables.
--
-- Criterion-by-criterion disposition:
--   warehouse            -> native (waves.warehouse_id already scopes candidates)
--   zone                 -> native, reuses fn_location_is_in_zone (7-3)
--   priority             -> shipments had NO priority column (only pick_lists/
--                            warehouse_tasks did) — genuinely WMS's own gap,
--                            added here (same enum, same convention)
--   route                -> shipments had no route column — WMS's own, added
--   carrier               -> shipments had no carrier column — WMS's own, added
--   delivery/service cutoff -> shipments had no cutoff column — WMS's own, added
--   release windows       -> wave-level gate against NOW(), needs no shipment data
--   order type            -> reuses EXISTING shipments.reference_type, no new column
--   inventory readiness    -> reuses EXISTING v_stock_balance.quantity_available (163)
--   replenishment readiness -> reuses EXISTING inventory_reorder_points (016)
--   customer/service level -> Sefay's customers table has no tier/service-level
--                            field anywhere (confirmed by search) — this belongs
--                            to the Customers domain, not Inventory's to invent.
--                            Supported as an opaque pass-through criteria key
--                            (criteria.customer_service_level_ok), respected
--                            exactly as given, never computed by this function.
--   capacity/labor/dock    -> explicitly out-of-domain per §5.4 — same opaque
--                            pass-through treatment, all-or-nothing per wave
--                            (Inventory has no way to resolve these per-shipment).

ALTER TABLE shipments ADD COLUMN priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent'));
ALTER TABLE shipments ADD COLUMN route TEXT;
ALTER TABLE shipments ADD COLUMN carrier TEXT;
ALTER TABLE shipments ADD COLUMN cutoff_at TIMESTAMPTZ;
CREATE INDEX idx_shipments_priority ON shipments(tenant_id, warehouse_id, priority) WHERE status = 'pending';

-- Evaluates every pending shipment in the wave's own warehouse against
-- waves.criteria, upserting one wave_shipments row per shipment with
-- either included_reason or excluded_reason recording exactly which
-- criteria were checked. Transitions the wave planning -> evaluating ->
-- reviewing, logging both real transitions to warehouse_work_status_
-- history (entity_type='wave', matching 7-1/7-2's established pattern).
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
BEGIN
  SELECT * INTO v_wave FROM waves WHERE id = p_wave_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'wave % not found', p_wave_id;
  END IF;
  IF v_wave.status <> 'planning' THEN
    RAISE EXCEPTION 'wave % cannot be evaluated (status=%) — evaluation only runs from planning', p_wave_id, v_wave.status;
  END IF;

  -- Release window: a wave-level gate against NOW(), not a per-shipment filter.
  IF v_wave.criteria ? 'release_after' AND NOW() < (v_wave.criteria->>'release_after')::timestamptz THEN
    RAISE EXCEPTION 'WAVE_NOT_YET_IN_RELEASE_WINDOW: wave % cannot be evaluated before %', p_wave_id, v_wave.criteria->>'release_after';
  END IF;
  IF v_wave.criteria ? 'release_before' AND NOW() > (v_wave.criteria->>'release_before')::timestamptz THEN
    RAISE EXCEPTION 'WAVE_PAST_RELEASE_WINDOW: wave % release window closed at %', p_wave_id, v_wave.criteria->>'release_before';
  END IF;

  UPDATE waves SET status = 'evaluating', evaluated_at = NOW(), updated_at = NOW() WHERE id = p_wave_id;
  INSERT INTO warehouse_work_status_history (tenant_id, entity_type, entity_id, old_status, new_status, actor_id)
  VALUES (p_tenant_id, 'wave', p_wave_id, 'planning', 'evaluating', p_actor_id);

  -- Opaque external signals (§5.4 / customer-service-level): if explicitly
  -- given as false, nothing in this wave is eligible — Inventory cannot
  -- resolve these per-shipment, only respect them as a wave-wide gate.
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
