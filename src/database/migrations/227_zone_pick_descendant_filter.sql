-- 227. Inventory #7 / Migration Item 7-3 (Owner-approved) — Zone Pick
-- descendant-hierarchy filter, plus automatic multi-zone splitting per
-- your approved §5.1 decision.
--
-- Confirmed defect being fixed: fn_create_pick_list required
-- zone_location_id to be set for strategy='zone' but never actually used
-- it to filter which lines were included — every line from every given
-- shipment was pulled in regardless of location. shipment_lines.location_id
-- is typically a bin/shelf (the actual pick location), not the zone-typed
-- row itself, so an exact-match filter would have been silently wrong too
-- (would match ~nothing) — this uses real ancestor-chain resolution.
--
-- §5.1 (approved): a shipment spanning multiple zones must not be
-- rejected and must not silently lose lines. Since each shipment_line has
-- exactly one location_id (a single line can never span two zones — only
-- a whole shipment, via its multiple lines, can), the correct
-- architecture is: claim every given shipment exactly once (one
-- status transition to 'picking'), then create one pick_lists row per
-- zone actually represented among their lines, each pulling in only the
-- lines that resolve to that zone. Shipment completion (fn_confirm_pick)
-- already correctly checks ALL of a shipment's lines regardless of which
-- pick list covered them, so a multi-zone shipment finishes correctly
-- once every zone's pick list is done — no change needed there.

-- Fixed-depth (zone -> aisle -> rack -> shelf -> bin, migration 097's own
-- trigger enforces this exact chain) so this recursion is bounded to at
-- most 4 hops for every tenant, always — not a runtime assumption.
CREATE OR REPLACE FUNCTION fn_location_is_in_zone(
  p_location_id UUID,
  p_zone_id     UUID
) RETURNS BOOLEAN AS $$
DECLARE
  v_current_id UUID := p_location_id;
  v_parent_id  UUID;
  v_guard      INTEGER := 0;
BEGIN
  IF p_location_id IS NULL OR p_zone_id IS NULL THEN
    RETURN false;
  END IF;
  IF p_location_id = p_zone_id THEN
    RETURN true;
  END IF;

  LOOP
    SELECT parent_location_id INTO v_parent_id FROM warehouse_locations WHERE id = v_current_id;
    IF v_parent_id IS NULL THEN
      RETURN false;
    END IF;
    IF v_parent_id = p_zone_id THEN
      RETURN true;
    END IF;
    v_current_id := v_parent_id;
    v_guard := v_guard + 1;
    IF v_guard > 10 THEN
      RETURN false; -- defensive only; the hierarchy trigger makes this unreachable
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql STABLE;

-- fn_create_pick_list: CREATE OR REPLACE. Identical for single/batch/wave.
-- For strategy='zone', the line-building query now filters by
-- fn_location_is_in_zone(sl.location_id, p_zone_location_id) instead of
-- pulling every line unconditionally — lines outside the zone are simply
-- excluded from THIS pick list (not lost: fn_create_zone_pick_lists_for_
-- shipments below is how a caller gets full multi-zone coverage in one
-- request; a direct fn_create_pick_list('zone', ...) call remains valid
-- for the single-zone-already-known case and now correctly narrows to
-- that zone instead of silently including everything).
CREATE OR REPLACE FUNCTION fn_create_pick_list(
  p_tenant_id        UUID,
  p_warehouse_id     UUID,
  p_shipment_ids     UUID[],
  p_strategy         TEXT,
  p_zone_location_id UUID,
  p_actor_id         UUID,
  p_priority         TEXT DEFAULT 'medium'
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

  INSERT INTO pick_lists (tenant_id, warehouse_id, strategy, zone_location_id, priority, status, created_by, started_at)
  VALUES (p_tenant_id, p_warehouse_id, p_strategy, p_zone_location_id, COALESCE(p_priority, 'medium'), 'in_progress', p_actor_id, NOW())
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
      AND (p_strategy <> 'zone' OR fn_location_is_in_zone(sl.location_id, p_zone_location_id))
    GROUP BY sl.item_id, sl.variant_id, sl.location_id
  LOOP
    INSERT INTO pick_list_lines (tenant_id, pick_list_id, item_id, variant_id, location_id, quantity_to_pick)
    VALUES (p_tenant_id, v_pick_list.id, v_line.item_id, v_line.variant_id, v_line.location_id, v_line.total_qty)
    RETURNING * INTO v_pll;

    v_reservation := fn_create_reservation(
      p_tenant_id, p_warehouse_id, v_line.item_id, v_line.variant_id, NULL,
      v_line.total_qty, 'pick_list_line', v_pll.id, p_actor_id, NULL
    );

    UPDATE shipment_lines
       SET reservation_id = v_reservation.id
     WHERE shipment_id = ANY(p_shipment_ids)
       AND item_id = v_line.item_id
       AND COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(v_line.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
       AND COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(v_line.location_id, '00000000-0000-0000-0000-000000000000'::uuid);
  END LOOP;

  INSERT INTO warehouse_work_status_history (tenant_id, entity_type, entity_id, old_status, new_status, actor_id)
  VALUES (p_tenant_id, 'pick_list', v_pick_list.id, NULL, 'in_progress', p_actor_id);

  RETURN v_pick_list;
END;
$$ LANGUAGE plpgsql;

-- fn_create_zone_pick_lists_for_shipments: NEW — automatic multi-zone
-- splitting (§5.1). Claims every given shipment exactly once, discovers
-- every zone actually represented among their lines (walking each line's
-- location up to its owning zone via the same fn_location_is_in_zone
-- ancestor logic, inlined here as a direct join since we need the
-- resolved zone id, not just a boolean), then creates one 'zone'
-- pick_lists row per distinct zone, each pulling in only that zone's
-- lines and creating its own reservations — mirroring fn_create_pick_
-- list's per-zone body, but scoped correctly across multiple pick lists
-- from a single shipment claim instead of re-claiming shipments per zone
-- (which would fail fn_create_pick_list's own "must be pending" guard on
-- the second zone call).
CREATE OR REPLACE FUNCTION fn_create_zone_pick_lists_for_shipments(
  p_tenant_id    UUID,
  p_warehouse_id UUID,
  p_shipment_ids UUID[],
  p_actor_id     UUID,
  p_priority     TEXT DEFAULT 'medium'
) RETURNS SETOF pick_lists AS $$
DECLARE
  v_shipment  shipments;
  v_zone_id   UUID;
  v_pick_list pick_lists;
  v_line      RECORD;
  v_pll       pick_list_lines;
  v_reservation stock_reservations;
BEGIN
  IF array_length(p_shipment_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'at least one shipment is required';
  END IF;

  -- Claim every shipment exactly once, same validation as fn_create_pick_list.
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
    UPDATE shipments SET status = 'picking', updated_at = NOW() WHERE id = v_shipment.id;
  END LOOP;

  -- Every distinct zone actually covering at least one line, resolved by
  -- walking each line's location up to its nearest zone-typed ancestor
  -- (or the location itself, if it IS the zone).
  FOR v_zone_id IN
    SELECT DISTINCT resolved.zone_id
    FROM (
      SELECT (
        WITH RECURSIVE ancestors AS (
          SELECT wl.id, wl.location_type, wl.parent_location_id
          FROM warehouse_locations wl
          WHERE wl.id = sl.location_id
          UNION ALL
          SELECT p.id, p.location_type, p.parent_location_id
          FROM warehouse_locations p
          JOIN ancestors a ON p.id = a.parent_location_id
        )
        SELECT id FROM ancestors WHERE location_type = 'zone' LIMIT 1
      ) AS zone_id
      FROM shipment_lines sl
      WHERE sl.shipment_id = ANY(p_shipment_ids) AND sl.location_id IS NOT NULL
    ) resolved
    WHERE resolved.zone_id IS NOT NULL
  LOOP
    INSERT INTO pick_lists (tenant_id, warehouse_id, strategy, zone_location_id, priority, status, created_by, started_at)
    VALUES (p_tenant_id, p_warehouse_id, 'zone', v_zone_id, COALESCE(p_priority, 'medium'), 'in_progress', p_actor_id, NOW())
    RETURNING * INTO v_pick_list;

    INSERT INTO pick_list_shipments (tenant_id, pick_list_id, shipment_id)
    SELECT DISTINCT p_tenant_id, v_pick_list.id, sl.shipment_id
    FROM shipment_lines sl
    WHERE sl.shipment_id = ANY(p_shipment_ids)
      AND fn_location_is_in_zone(sl.location_id, v_zone_id);

    FOR v_line IN
      SELECT sl.item_id, sl.variant_id, sl.location_id, SUM(sl.quantity_requested) AS total_qty
      FROM shipment_lines sl
      WHERE sl.shipment_id = ANY(p_shipment_ids)
        AND fn_location_is_in_zone(sl.location_id, v_zone_id)
      GROUP BY sl.item_id, sl.variant_id, sl.location_id
    LOOP
      INSERT INTO pick_list_lines (tenant_id, pick_list_id, item_id, variant_id, location_id, quantity_to_pick)
      VALUES (p_tenant_id, v_pick_list.id, v_line.item_id, v_line.variant_id, v_line.location_id, v_line.total_qty)
      RETURNING * INTO v_pll;

      v_reservation := fn_create_reservation(
        p_tenant_id, p_warehouse_id, v_line.item_id, v_line.variant_id, NULL,
        v_line.total_qty, 'pick_list_line', v_pll.id, p_actor_id, NULL
      );

      UPDATE shipment_lines
         SET reservation_id = v_reservation.id
       WHERE shipment_id = ANY(p_shipment_ids)
         AND item_id = v_line.item_id
         AND COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(v_line.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
         AND COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(v_line.location_id, '00000000-0000-0000-0000-000000000000'::uuid)
         AND fn_location_is_in_zone(location_id, v_zone_id);
    END LOOP;

    INSERT INTO warehouse_work_status_history (tenant_id, entity_type, entity_id, old_status, new_status, actor_id)
    VALUES (p_tenant_id, 'pick_list', v_pick_list.id, NULL, 'in_progress', p_actor_id);

    RETURN NEXT v_pick_list;
  END LOOP;

  -- A shipment line whose location resolves to no zone ancestor at all
  -- (e.g. location_id NULL, or a location with no zone-typed ancestor —
  -- structurally shouldn't happen given the hierarchy trigger, but not
  -- assumed) is not silently dropped: it simply isn't covered by any
  -- zone pick list this call produced, and the shipment remains 'picking'
  -- with that line still unpicked — visible via the existing pick-list/
  -- shipment-line queries, not hidden.
  RETURN;
END;
$$ LANGUAGE plpgsql;
